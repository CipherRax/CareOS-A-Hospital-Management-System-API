import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes, EVENT_VERSION } from '../../events/catalog';
import { newId } from '../../common/lib/uuidv7';

/**
 * The cap on a generated export artifact. A whole-org export is the largest
 * thing this can produce, and the cap is a runaway guard: an object far past
 * the recorded size is corrupt or substituted, and the download should fail
 * rather than quietly ship megabytes nobody asked for.
 */
export const MAX_EXPORT_ARTIFACT_BYTES = 50 * 1024 * 1024;

/** How long a generated artifact stays downloadable. */
export const EXPORT_TTL_HOURS = 24;

/**
 * Builds and serves data-subject export artifacts (brief §8).
 *
 * The artifact is produced *server-side* — the data originates here, so there
 * is no client to hand an upload URL to — and is stored in object storage under
 * an org-scoped key. The download is streamed back through the API rather than
 * handed out as a presigned URL: a presigned GET is a bearer capability that
 * outlives the caller's session and bypasses the organization check, which is
 * the wrong trade for a file full of patient data.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * Generates the artifact for one export row and marks it READY.
   *
   * Idempotent: a row that is no longer PENDING is left alone, so a replayed
   * outbox event does not rebuild an artifact somebody has already downloaded.
   */
  async build(exportId: string, organizationId: string): Promise<void> {
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.dataExport.findFirst({
      where: { id: exportId, organizationId },
    });
    if (!record) return;
    if (record.status !== 'PENDING') return;

    try {
      const payload = await this.collect(organizationId, record.patientId);
      const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
      const key = `exports/${organizationId}/${record.id}.json`;

      await this.storage.put(key, body, 'application/json');

      const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 60 * 60 * 1000);
      await db.dataExport.update({
        where: { id: record.id },
        data: {
          status: 'READY',
          storageKey: key,
          contentType: 'application/json',
          sizeBytes: body.byteLength,
          completedAt: new Date(),
          expiresAt,
        },
      });

      await this.emitCompleted(organizationId, record.id);
    } catch (err) {
      const message = err instanceof Error ? err.name : 'generation failed';
      this.logger.warn(
        `data export ${exportId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await db.dataExport
        .update({
          where: { id: record.id },
          data: { status: 'FAILED', failureReason: `generation failed (${message})` },
        })
        .catch((recordErr) => {
          this.logger.error(
            `could not record failure for data export ${exportId}: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
          );
        });
    }
  }

  /**
   * The patient's own data (or every patient's, for an org-wide export), as the
   * subject-access payload the brief asks for.
   */
  private async collect(organizationId: string, patientId: string | null) {
    const db = this.prisma.tenantFor(organizationId);
    const patients = await db.patient.findMany({
      where: { organizationId, ...(patientId ? { id: patientId } : {}) },
      orderBy: { id: 'asc' },
      take: 1000,
      select: {
        id: true,
        patientNumber: true,
        firstName: true,
        lastName: true,
        otherNames: true,
        dateOfBirth: true,
        sex: true,
        phone: true,
        email: true,
        address: true,
        county: true,
        town: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        allergies: { select: { id: true, substance: true, reaction: true, severity: true, status: true } },
        medicalHistory: { select: { id: true, category: true, description: true, onsetDate: true, notes: true } },
        consents: { select: { id: true, type: true, status: true, grantedAt: true, withdrawnAt: true } },
        appointments: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            reason: true,
          },
          orderBy: { startsAt: 'asc' },
          take: 200,
        },
        encounters: {
          select: { id: true, type: true, status: true, openedAt: true, completedAt: true },
          orderBy: { openedAt: 'asc' },
          take: 200,
        },
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      scope: patientId ? { patientId } : { organizationId },
      patients: patients.map((p) => ({
        ...p,
        dateOfBirth: p.dateOfBirth ? p.dateOfBirth.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        appointments: p.appointments.map((a) => ({
          ...a,
          startsAt: a.startsAt.toISOString(),
          endsAt: a.endsAt.toISOString(),
        })),
        encounters: p.encounters.map((e) => ({
          ...e,
          openedAt: e.openedAt.toISOString(),
          completedAt: e.completedAt ? e.completedAt.toISOString() : null,
        })),
      })),
    };
  }

  /** The artifact to stream for a download request. */
  async downloadTarget(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.dataExport.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new AppError({
        code: ErrorCodes.DATA_EXPORT_NOT_FOUND,
        message: 'Data export not found',
        silent: true,
      });
    }
    if (record.status !== 'READY' || !record.storageKey) {
      throw new AppError({
        code: ErrorCodes.DATA_EXPORT_NOT_READY,
        message:
          record.status === 'PENDING'
            ? 'Data export is still being generated; poll GET /privacy/data-exports/:id'
            : `Data export is ${record.status.toLowerCase()}, not downloadable`,
        silent: true,
      });
    }
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      await this.expire(record.id, record.storageKey).catch(() => undefined);
      throw new AppError({
        code: ErrorCodes.DATA_EXPORT_EXPIRED,
        message: 'Data export has expired (exports are available for 24 hours)',
        silent: true,
      });
    }
    return {
      contentType: record.contentType ?? 'application/json',
      sizeBytes: record.sizeBytes,
      storageKey: record.storageKey,
      filename: `careos-data-export-${record.id}.json`,
    };
  }

  /** Removes a stored artifact and clears the pointer on an expired row. */
  private async expire(exportId: string, storageKey: string | null): Promise<void> {
    if (storageKey) {
      await this.storage.remove(storageKey).catch((err) => {
        this.logger.warn(
          `could not remove expired data export artifact ${storageKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    await this.prisma
      .tenantFor(this.tenantContext.requireOrg())
      .dataExport.update({ where: { id: exportId }, data: { status: 'EXPIRED', storageKey: null } });
  }

  /** Marks an export as failed. Used by the consumer when generation throws. */
  async fail(exportId: string, organizationId: string, reason: string): Promise<void> {
    const db = this.prisma.tenantFor(organizationId);
    await db.dataExport.update({
      where: { id: exportId },
      data: { status: 'FAILED', failureReason: reason },
    });
  }

  /** Emits the completion event for a finished export. */
  private async emitCompleted(organizationId: string, exportId: string): Promise<void> {
    const db = this.prisma.unscoped();
    await db.outboxEvent.create({
      data: {
        id: newId(),
        organizationId,
        type: EventTypes.DataExportCompleted,
        version: EVENT_VERSION[EventTypes.DataExportCompleted],
        aggregateType: 'DataExport',
        aggregateId: exportId,
        // Id only: the artifact's contents are patient data and must not
        // travel through the event bus.
        payload: { dataExportId: exportId },
        status: 'PENDING',
        occurredAt: new Date(),
      },
    });
  }
}
