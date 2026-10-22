import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { TxRunner } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import {
  isRetentionCategory,
  planAnonymization,
} from './domain/retention';
import type {
  DataExportResponseDto,
  LegalHoldResponseDto,
  PlaceLegalHoldDto,
  ReleaseLegalHoldDto,
  RetentionPolicyResponseDto,
  UpdateRetentionPolicyDto,
  UpsertRetentionPolicyDto,
} from './dto/privacy.dto';

/** How long a generated export artifact stays downloadable. */
export const DATA_EXPORT_TTL_HOURS = 24;

interface RetentionSweepEntry {
  category: string;
  action: string;
  processed: number;
  anonymized: number;
  archived: number;
  /** Records skipped because a legal hold blocks the action. */
  held: number;
  /** Records flagged for a human decision (REVIEW action). */
  review: number;
}

/**
 * Privacy surface (brief §8).
 *
 * Three things live here:
 *
 *  - **Retention policies** are org reference data: one row per record
 *    category, holding a retention window and the action to take when it
 *    elapses.
 *  - **Legal holds** make a patient's graph ineligible for automated deletion
 *    or anonymization. Placing a hold is idempotent-safe (a second active hold
 *    for the same patient is refused, not stacked), and releasing one is
 *    recorded rather than deleted, so the hold history survives.
 *  - **Data exports** are asynchronous, permission-controlled, audited jobs
 *    whose artifact lives in object storage and is downloaded through an
 *    authorized API — never a public URL.
 *
 * Every write is audited, and every event payload carries ids only.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly txRunner: TxRunner,
  ) {}

  // ---------------------------------------------------------------------------
  // retention policies
  // ---------------------------------------------------------------------------

  async listRetentionPolicies(): Promise<RetentionPolicyResponseDto[]> {
    const organizationId = this.tenantContext.requireOrg();
    const rows = await this.prisma
      .tenantFor(organizationId)
      .retentionPolicy.findMany({ orderBy: { category: 'asc' } });
    return rows.map((r) => this.serializePolicy(r));
  }

  /**
   * Creates or replaces the policy for one category. The category is the
   * natural key within an org, so a second POST for the same category updates
   * it rather than creating a conflicting second policy.
   */
  async upsertRetentionPolicy(input: UpsertRetentionPolicyDto): Promise<RetentionPolicyResponseDto> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;
    if (!isRetentionCategory(input.category)) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown retention category: ${input.category}`,
      });
    }

    const db = this.prisma.tenantFor(organizationId);
    const row = await db.retentionPolicy.upsert({
      where: { organizationId_category: { organizationId, category: input.category } },
      create: {
        id: newId(),
        organizationId,
        category: input.category,
        retentionDays: input.retentionDays,
        action: input.action,
        enabled: input.enabled,
      },
      update: {
        retentionDays: input.retentionDays,
        action: input.action,
        enabled: input.enabled,
      },
    });

    await this.audit.record({
      organizationId,
      action: 'privacy.retention_policy.upserted',
      resource: 'retentionPolicy',
      resourceId: row.id,
      userId: userId ?? undefined,
      metadata: { category: row.category, retentionDays: row.retentionDays, action: row.action },
    });

    return this.serializePolicy(row);
  }

  async updateRetentionPolicy(
    id: string,
    input: UpdateRetentionPolicyDto,
  ): Promise<RetentionPolicyResponseDto> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;
    const db = this.prisma.tenantFor(organizationId);

    const existing = await db.retentionPolicy.findFirst({ where: { id, organizationId } });
    if (!existing) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Retention policy not found.',
      });
    }

    const row = await db.retentionPolicy.update({
      where: { id },
      data: {
        ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });

    await this.audit.record({
      organizationId,
      action: 'privacy.retention_policy.updated',
      resource: 'retentionPolicy',
      resourceId: id,
      userId: userId ?? undefined,
      metadata: {
        retentionDays: row.retentionDays,
        action: row.action,
        enabled: row.enabled,
      },
    });

    return this.serializePolicy(row);
  }

  // ---------------------------------------------------------------------------
  // legal holds
  // ---------------------------------------------------------------------------

  async listLegalHolds(options: { patientId?: string; activeOnly?: boolean } = {}) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const rows = await db.legalHold.findMany({
      where: {
        organizationId,
        ...(options.patientId ? { patientId: options.patientId } : {}),
        ...(options.activeOnly ? { releasedAt: null } : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.serializeHold(r));
  }

  /**
   * Places a hold. A patient may have only one *active* hold: a second attempt
   * is refused with LEGAL_HOLD_ALREADY_ACTIVE rather than silently stacking
   * holds that would have to be released one by one.
   */
  async placeLegalHold(input: PlaceLegalHoldDto): Promise<LegalHoldResponseDto> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;

    return this.txRunner.run(async (ctx) => {
      const db = ctx.db;
      const patient = await db.patient.findFirst({
        where: { id: input.patientId, organizationId },
        select: { id: true },
      });
      if (!patient) {
        throw new AppError({
          code: ErrorCodes.PATIENT_NOT_FOUND,
          message: 'Patient not found.',
        });
      }

      const active = await db.legalHold.findFirst({
        where: { organizationId, patientId: input.patientId, releasedAt: null },
        select: { id: true },
      });
      if (active) {
        throw new AppError({
          code: ErrorCodes.LEGAL_HOLD_ALREADY_ACTIVE,
          message: 'An active legal hold already covers this patient.',
          details: { legalHoldId: active.id },
        });
      }

      const row = await db.legalHold.create({
        data: {
          id: newId(),
          organizationId,
          patientId: input.patientId,
          reason: input.reason,
          placedById: userId,
        },
      });

      ctx.emit({
        type: EventTypes.LegalHoldPlaced,
        aggregateType: 'legal_hold',
        aggregateId: row.id,
        payload: { legalHoldId: row.id, patientId: row.patientId },
      });

      await this.audit.record({
        organizationId,
          action: 'privacy.legal_hold.placed',
        resource: 'legalHold',
        resourceId: row.id,
        userId: userId ?? undefined,
        metadata: { patientId: row.patientId },
      });

      return this.serializeHold(row);
    });
  }

  async releaseLegalHold(id: string, input: ReleaseLegalHoldDto): Promise<LegalHoldResponseDto> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;

    return this.txRunner.run(async (ctx) => {
      const db = ctx.db;
      const hold = await db.legalHold.findFirst({ where: { id, organizationId } });
      if (!hold) {
        throw new AppError({
          code: ErrorCodes.LEGAL_HOLD_NOT_FOUND,
          message: 'Legal hold not found.',
        });
      }
      if (hold.releasedAt) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'This legal hold has already been released.',
          details: { legalHoldId: hold.id, releasedAt: hold.releasedAt },
        });
      }

      const row = await db.legalHold.update({
        where: { id },
        data: { releasedAt: new Date(), releasedById: userId, releaseReason: input.releaseReason },
      });

      ctx.emit({
        type: EventTypes.LegalHoldReleased,
        aggregateType: 'legal_hold',
        aggregateId: row.id,
        payload: { legalHoldId: row.id, patientId: row.patientId },
      });

      await this.audit.record({
        organizationId,
          action: 'privacy.legal_hold.released',
        resource: 'legalHold',
        resourceId: id,
        userId: userId ?? undefined,
        metadata: { patientId: hold.patientId },
      });

      return this.serializeHold(row);
    });
  }

  /** True when the patient has an active hold. */
  async hasActiveHold(patientId: string): Promise<boolean> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const hold = await db.legalHold.findFirst({
      where: { organizationId, patientId, releasedAt: null },
      select: { id: true },
    });
    return hold !== null;
  }

  // ---------------------------------------------------------------------------
  // data exports
  // ---------------------------------------------------------------------------

  /**
   * Records an export request and returns immediately. The artifact is built
   * asynchronously (an export over a whole org can take minutes, and a request
   * that blocks on it would time out), so the row starts PENDING and the
   * `Privacy.DataExportRequested` event asks the worker to build it.
   */
  async requestDataExport(input: {
    patientId?: string;
    format?: string;
  }): Promise<DataExportResponseDto> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;

    return this.txRunner.run(async (ctx) => {
      if (input.patientId) {
        const patient = await ctx.db.patient.findFirst({
          where: { id: input.patientId, organizationId },
          select: { id: true },
        });
        if (!patient) {
          throw new AppError({
            code: ErrorCodes.PATIENT_NOT_FOUND,
            message: 'Patient not found.',
          });
        }
      }

      const row = await ctx.db.dataExport.create({
        data: {
          id: newId(),
          organizationId,
          patientId: input.patientId ?? null,
          requestedById: userId,
          format: input.format ?? 'JSON',
          status: 'PENDING',
        },
      });

      ctx.emit({
        type: EventTypes.DataExportRequested,
        aggregateType: 'data_export',
        aggregateId: row.id,
        payload: { dataExportId: row.id, patientId: row.patientId },
      });

      await this.audit.record({
        organizationId,
          action: 'privacy.data_export.requested',
        resource: 'dataExport',
        resourceId: row.id,
        userId: userId ?? undefined,
        metadata: { patientId: row.patientId, format: row.format },
      });

      return this.serializeExport(row);
    });
  }

  async listDataExports(options: { status?: string } = {}): Promise<DataExportResponseDto[]> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const rows = await db.dataExport.findMany({
      where: {
        organizationId,
        ...(options.status ? { status: options.status as 'PENDING' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.serializeExport(r));
  }

  async getDataExport(id: string): Promise<DataExportResponseDto> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const row = await db.dataExport.findFirst({ where: { id, organizationId } });
    if (!row) {
      throw new AppError({
        code: ErrorCodes.DATA_EXPORT_NOT_FOUND,
        message: 'Data export not found.',
      });
    }
    return this.serializeExport(row);
  }

  /**
   * Anonymizes one patient on request (a data-subject erasure).
   *
   * A legal hold blocks it: the answer is 409 LEGAL_HOLD_ACTIVE, because the
   * caller asked for something the hold forbids and the reason must be
   * explicit — a silently skipped request would look like a completed one.
   */
  async anonymizePatient(patientId: string): Promise<{ patientId: string; anonymized: boolean }> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;
    const db = this.prisma.tenantFor(organizationId);

    const patient = await db.patient.findFirst({
      where: { id: patientId, organizationId },
      select: { id: true },
    });
    if (!patient) {
      throw new AppError({
        code: ErrorCodes.PATIENT_NOT_FOUND,
        message: 'Patient not found.',
      });
    }

    const hold = await db.legalHold.findFirst({
      where: { organizationId, patientId, releasedAt: null },
      select: { id: true },
    });
    if (hold) {
      throw new AppError({
        code: ErrorCodes.LEGAL_HOLD_ACTIVE,
        message:
          'An active legal hold covers this patient, so the record cannot be anonymized.',
        details: { legalHoldId: hold.id },
      });
    }

    const plan = planAnonymization(patient.id);
    await db.patient.update({
      where: { id: patient.id },
      data: { ...plan, status: 'ARCHIVED' },
    });

    await this.audit.record({
      organizationId,
      action: 'privacy.patient.anonymized',
      resource: 'patient',
      resourceId: patient.id,
      userId: userId ?? undefined,
      metadata: { source: 'manual_request' },
    });

    return { patientId: patient.id, anonymized: true };
  }

  // ---------------------------------------------------------------------------
  // retention sweep (the anonymization pipeline)
  // ---------------------------------------------------------------------------

  /**
   * Applies the org's enabled retention policies to the records whose window
   * has elapsed.
   *
   * The sweep is conservative by construction:
   *  - a patient under an active legal hold is **skipped**, never modified;
   *  - a policy whose action is REVIEW changes nothing and is reported for a
   *    human decision;
   *  - categories that must not be rewritten (financial and audit records) are
   *    reported only.
   *
   * The result is a per-category report so an operator can see what was
   * changed, what was held, and what still needs a decision.
   */
  async runRetentionSweep(now: Date = new Date()): Promise<RetentionSweepEntry[]> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;
    const db = this.prisma.tenantFor(organizationId);

    const policies = await db.retentionPolicy.findMany({
      where: { organizationId, enabled: true },
      orderBy: { category: 'asc' },
    });

    const report: RetentionSweepEntry[] = [];

    for (const policy of policies) {
      const entry: RetentionSweepEntry = {
        category: policy.category,
        action: policy.action,
        processed: 0,
        anonymized: 0,
        archived: 0,
        held: 0,
        review: 0,
      };

      const cutoff = new Date(now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000);

      if (policy.action === 'REVIEW') {
        // Nothing is changed: a human decides.
        const candidates = await this.sweepCandidates(db, policy.category, cutoff);
        entry.processed = candidates.length;
        entry.review = candidates.length;
        report.push(entry);
        continue;
      }

      if (policy.category === 'invoice' || policy.category === 'audit_log') {
        // Financial and audit records are not rewritten by a sweep. They are
        // reported so a human can act, which is honest about the limit.
        const candidates = await this.sweepCandidates(db, policy.category, cutoff);
        entry.processed = candidates.length;
        entry.review = candidates.length;
        report.push(entry);
        continue;
      }

      const candidates = await this.sweepCandidates(db, policy.category, cutoff);
      for (const candidate of candidates) {
        const held = await this.hasActiveHold(candidate.patientId);
        if (held) {
          entry.held += 1;
          continue;
        }

        if (policy.category === 'patient') {
          if (policy.action === 'ARCHIVE') {
            await db.patient.update({
              where: { id: candidate.id },
              data: { status: 'ARCHIVED' },
            });
            entry.archived += 1;
          } else {
            const plan = planAnonymization(candidate.id);
            await db.patient.update({
              where: { id: candidate.id },
              data: { ...plan, status: 'ARCHIVED' },
            });
            entry.anonymized += 1;
          }
        } else {
          // Clinical content: the record stays (it is part of the clinical and
          // billing history) but its content is removed.
          await this.redactClinicalContent(db, policy.category, candidate.id, candidate.patientId);
          entry.anonymized += 1;
        }

        entry.processed += 1;
      }

      report.push(entry);
    }

    await this.audit.record({
      organizationId,
      action: 'privacy.retention.sweep_run',
      resource: 'retentionPolicy',
      resourceId: 'sweep',
      userId: userId ?? undefined,
      metadata: { report },
    });

    return report;
  }

  /** Candidate records for a category whose window has elapsed. */
  private async sweepCandidates(
    db: ReturnType<PrismaService['tenantFor']>,
    category: string,
    cutoff: Date,
  ): Promise<Array<{ id: string; patientId: string }>> {
    if (category === 'patient') {
      const rows = await db.patient.findMany({
        where: {
          createdAt: { lt: cutoff },
          status: { not: 'ARCHIVED' },
          mergedIntoPatientId: null,
        },
        select: { id: true },
        take: 500,
      });
      return rows.map((r) => ({ id: r.id, patientId: r.id }));
    }

    if (category === 'encounter') {
      const rows = await db.encounter.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, patientId: true },
        take: 500,
      });
      return rows;
    }

    if (category === 'clinical_note') {
      const rows = await db.clinicalNote.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, patientId: true },
        take: 500,
      });
      return rows;
    }

    if (category === 'lab_result') {
      const rows = await db.labResult.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, orderItem: { select: { order: { select: { patientId: true } } } } },
        take: 500,
      });
      return rows.map((r) => ({ id: r.id, patientId: r.orderItem.order.patientId }));
    }

    if (category === 'radiology_report') {
      const rows = await db.imagingReport.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, order: { select: { patientId: true } } },
        take: 500,
      });
      return rows.map((r) => ({ id: r.id, patientId: r.order.patientId }));
    }

    if (category === 'invoice') {
      const rows = await db.invoice.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, patientId: true },
        take: 500,
      });
      return rows;
    }

    return [];
  }

  /** Removes the content of a clinical record while keeping the record itself. */
  private async redactClinicalContent(
    db: ReturnType<PrismaService['tenantFor']>,
    category: string,
    id: string,
    patientId: string,
  ): Promise<void> {
    if (category === 'encounter') {
      await db.encounter.update({ where: { id }, data: { note: null } });
      return;
    }
    if (category === 'clinical_note') {
      await db.clinicalNote.update({
        where: { id },
        data: { sections: {} as Prisma.InputJsonObject, title: null },
      });
      return;
    }
    if (category === 'lab_result') {
      await db.labResult.update({ where: { id }, data: { value: '[redacted]' } });
      return;
    }
    if (category === 'radiology_report') {
      await db.imagingReport.update({
        where: { id },
        data: { findings: null, summary: null, impression: null },
      });
      return;
    }
    void patientId;
  }

  // ---------------------------------------------------------------------------
  // serialization
  // ---------------------------------------------------------------------------

  private serializePolicy(row: {
    id: string;
    category: string;
    retentionDays: number;
    action: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): RetentionPolicyResponseDto {
    return {
      id: row.id,
      category: row.category,
      retentionDays: row.retentionDays,
      action: row.action,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeHold(row: {
    id: string;
    patientId: string;
    reason: string;
    placedById: string | null;
    placedAt: Date;
    releasedAt: Date | null;
    releasedById: string | null;
    releaseReason: string | null;
  }): LegalHoldResponseDto {
    return {
      id: row.id,
      patientId: row.patientId,
      reason: row.reason,
      placedById: row.placedById,
      placedAt: row.placedAt.toISOString(),
      releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
      releasedById: row.releasedById,
      releaseReason: row.releaseReason,
      active: row.releasedAt === null,
    };
  }

  private serializeExport(row: {
    id: string;
    patientId: string | null;
    requestedById: string | null;
    status: string;
    format: string;
    sizeBytes: number | null;
    failureReason: string | null;
    expiresAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }): DataExportResponseDto {
    return {
      id: row.id,
      patientId: row.patientId,
      requestedById: row.requestedById,
      status: row.status,
      format: row.format,
      sizeBytes: row.sizeBytes,
      failureReason: row.failureReason,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
