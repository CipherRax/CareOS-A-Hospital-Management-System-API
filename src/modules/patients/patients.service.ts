import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { TxRunner, type TxContext, type TxClient } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EventTypes } from '../../events/catalog';
import {
  DUPLICATE_THRESHOLD,
  scoreDuplicate,
  type PatientKeyFacts,
} from './domain/duplicate-score';
import {
  formatPatientNumber,
  nextPatientSequence,
} from './domain/patient-number';
import type {
  AddAllergyDto,
  AddGuardianDto,
  AddMedicalHistoryDto,
  AmendAllergyDto,
  CreatePatientDto,
  GrantConsentDto,
  UpdateAllergyStatusDto,
  UpdatePatientDto,
  WithdrawConsentDto,
} from './dto/patient.dto';
import type { ConsentType, Patient, Prisma } from '@prisma/client';

/** Request metadata captured into patient access logs (never PHI). */
export interface AccessContext {
  ip?: string;
  userAgent?: string;
}

const TIMELINE_VISIBLE_TO = PERMISSION_GROUPS.patients.read;

/**
 * Patients module (brief Phase 2).
 *
 * - Registration assigns an org-scoped patient number (PAT-YYYY-NNNNNN) from an
 *   atomic counter and runs duplicate detection; an unflagged match clears the
 *   threshold and returns 409 POSSIBLE_DUPLICATE.
 * - Every single-record read is access-logged (identifiers + request metadata
 *   only, never PHI). List/search endpoints are not individually logged.
 * - Timeline entries carry the permission required to read them; reads filter
 *   by the caller's effective permissions.
 * - A patient-participant principal (self-scope patientId) may only reach its
 *   own record: PATIENT_ACCESS_DENIED otherwise.
 * - Merge is reversible-by-design: the superseded record is kept as MERGED
 *   with a pointer to the survivor instead of being deleted.
 */
@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly txRunner: TxRunner,
  ) {}

  // ---------------------------------------------------------------------------
  // registration
  // ---------------------------------------------------------------------------

  async register(input: CreatePatientDto) {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;
    const db = this.prisma.tenantFor(organizationId);

    const candidates = await this.findCandidates(db, input);
    const scored = candidates
      .map((c) => ({ patient: c, ...scoreDuplicate(input, c) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (
      best &&
      best.score >= DUPLICATE_THRESHOLD &&
      input.confirmDuplicate !== true
    ) {
      throw new AppError({
        code: ErrorCodes.POSSIBLE_DUPLICATE,
        message:
          'A patient with matching identity already exists. Confirm it is a duplicate or review the record.',
        details: {
          candidates: scored
            .filter((s) => s.score >= DUPLICATE_THRESHOLD)
            .map((s) => ({
              patientId: s.patient.id,
              patientNumber: s.patient.patientNumber,
              firstName: s.patient.firstName,
              lastName: s.patient.lastName,
              dateOfBirth: s.patient.dateOfBirth,
              score: s.score,
              reasons: s.reasons,
            })),
        },
        silent: true,
      });
    }

    const patient = await this.txRunner.run(async (ctx: TxContext) => {
      const seq = await nextPatientSequence(ctx.db, organizationId);
      const patientNumber = formatPatientNumber(seq);

      const created = await ctx.db.patient.create({
        data: {
          id: newId(),
          organizationId,
          patientNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          otherNames: input.otherNames ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
          sex: input.sex ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          county: input.county ?? null,
          town: input.town ?? null,
          photoUrl: input.photoUrl ?? null,
          duplicateConfirmedAt:
            input.confirmDuplicate === true ? new Date() : null,
          duplicateConfirmedBy: input.confirmDuplicate === true ? userId : null,
          duplicateConfirmReason:
            input.confirmDuplicate === true
              ? (input.duplicateConfirmReason ?? null)
              : null,
          status: 'ACTIVE',
          version: 1,
        },
      });

      if (input.confirmDuplicate === true) {
        await this.appendTimeline(ctx, created.id, {
          type: 'patient.duplicate_confirmed',
          title: 'Duplicate confirmation recorded during registration',
          requiredPermission: TIMELINE_VISIBLE_TO,
        });
      }
      await this.appendTimeline(ctx, created.id, {
        type: 'patient.registered',
        title: `Registered as ${patientNumber}`,
        requiredPermission: TIMELINE_VISIBLE_TO,
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.register',
          resource: 'patient',
          resourceId: created.id,
          newState: { patientNumber, fullName: `${input.firstName} ${input.lastName}` },
        },
      });

      ctx.emit({
        type: EventTypes.PatientRegistered,
        aggregateType: 'patient',
        aggregateId: created.id,
        payload: { patientId: created.id, patientNumber },
      });

      return created;
    });

    return { patient: serialize(patient, { includeContact: true }) };
  }

  async list(params: { page?: number; limit?: number; q?: string; status?: string }) {
    const organizationId = this.tenantContext.requireOrg();
    const scope = this.tenantContext.scope;
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.PatientWhereInput = {};
    // Self-scoped patient principal: only ever sees its own record.
    if (scope.patientId) {
      where.id = scope.patientId;
    }
    if (params.status) {
      where.status = params.status as Patient['status'];
    }
    if (params.q) {
      const q = params.q.trim();
      where.OR = [
        { patientNumber: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.patient.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.patient.count({ where }),
    ]);

    return pageOf(
      rows.map((p) => serialize(p, { includeContact: this.mayViewContact(scope.permissions) })),
      total,
      page,
      limit,
    ) as PageResult<ReturnType<typeof serialize>>;
  }

  async findById(
    id: string,
    access?: AccessContext,
  ) {
    this.assertPatientOwnership(id);
    const organizationId = this.tenantContext.requireOrg();
    const patient = await this.requirePatient(this.prisma.tenantFor(organizationId), id);
    await this.logAccess(patient.id, 'demographics', this.tenantContext.scope.userId, access);
    return { patient: serialize(patient, { includeContact: this.mayViewContact(this.tenantContext.scope.permissions) }) };
  }

  async update(id: string, input: UpdatePatientDto) {
    this.assertPatientOwnership(id);
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.patient.findFirst({ where: { id } });
      if (!current) throw patientNotFound();

      if (
        input.version !== undefined &&
        input.version !== current.version
      ) {
        throw new AppError({
          code: ErrorCodes.VERSION_CONFLICT,
          message: `Record was modified concurrently. Current version: ${current.version}.`,
          silent: true,
        });
      }

      const updated = await ctx.db.patient.update({
        where: { id },
        data: {
          firstName: input.firstName ?? current.firstName,
          lastName: input.lastName ?? current.lastName,
          otherNames:
            input.otherNames === undefined ? current.otherNames : input.otherNames,
          dateOfBirth:
            input.dateOfBirth === undefined ? current!.dateOfBirth : input.dateOfBirth,
          sex: input.sex === undefined ? current.sex : input.sex,
          phone: input.phone === undefined ? current.phone : input.phone,
          email: input.email === undefined ? current.email : input.email,
          address: input.address === undefined ? current.address : input.address,
          county: input.county === undefined ? current.county : input.county,
          town: input.town === undefined ? current.town : input.town,
          photoUrl: input.photoUrl === undefined ? current.photoUrl : input.photoUrl,
          version: { increment: 1 },
        },
      });

      await this.appendTimeline(ctx, id, {
        type: 'patient.updated',
        title: 'Record updated',
        requiredPermission: TIMELINE_VISIBLE_TO,
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.update',
          resource: 'patient',
          resourceId: id,
          previousState: { version: current.version },
          newState: { version: updated.version, changed: Object.keys(input) },
        },
      });
      ctx.emit({
        type: EventTypes.PatientUpdated,
        aggregateType: 'patient',
        aggregateId: id,
        payload: { patientId: id, version: updated.version },
      });
      return updated;
    });

    return {
      patient: serialize(result, {
        includeContact: this.mayViewContact(this.tenantContext.scope.permissions),
      }),
    };
  }

  async confirmNotDuplicate(id: string, reason: string) {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;

    const patient = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.patient.findFirst({ where: { id } });
      if (!current) throw patientNotFound();

      const updated = await ctx.db.patient.update({
        where: { id },
        data: {
          duplicateConfirmedAt: new Date(),
          duplicateConfirmedBy: userId,
          duplicateConfirmReason: reason,
          version: { increment: 1 },
        },
      });
      await this.appendTimeline(ctx, id, {
        type: 'patient.duplicate_confirmed',
        title: 'Confirmed not a duplicate',
        requiredPermission: TIMELINE_VISIBLE_TO,
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.confirm_not_duplicate',
          resource: 'patient',
          resourceId: id,
          reason,
          newState: { duplicateConfirmedBy: userId },
        },
      });
      ctx.emit({
        type: EventTypes.PatientDuplicateConfirmed,
        aggregateType: 'patient',
        aggregateId: id,
        payload: { patientId: id },
      });
      return updated;
    });

    return {
      patient: serialize(patient, {
        includeContact: this.mayViewContact(this.tenantContext.scope.permissions),
      }),
    };
  }

  async merge(targetId: string, input: { sourcePatientId: string; reason: string }) {
    const { sourcePatientId, reason } = input;
    if (sourcePatientId === targetId) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'A patient cannot be merged into itself.',
        silent: true,
      });
    }
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;

    return this.txRunner.run(async (ctx: TxContext) => {
      const [target, source] = await Promise.all([
        ctx.db.patient.findFirst({ where: { id: targetId } }),
        ctx.db.patient.findFirst({ where: { id: sourcePatientId } }),
      ]);
      if (!target) throw patientNotFound('Target patient not found');
      if (!source) throw patientNotFound('Source patient not found');
      if (source.status !== 'ACTIVE' || target.status !== 'ACTIVE') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'Only ACTIVE patients can be merged.',
          silent: true,
        });
      }

      // Mark the source as MERGED with a pointer to the survivor (reversible).
      await ctx.db.patient.update({
        where: { id: source.id },
        data: {
          status: 'MERGED',
          mergedIntoPatientId: target.id,
          mergedAt: new Date(),
          mergedReason: reason,
          version: { increment: 1 },
        },
      });

      // Re-point guardians: skip links the target already has.
      const sourceGuardians = await ctx.db.patientGuardian.findMany({
        where: { patientId: source.id },
      });
      for (const link of sourceGuardians) {
        const exists = await ctx.db.patientGuardian.findFirst({
          where: { patientId: target.id, guardianId: link.guardianId },
          select: { id: true },
        });
        if (exists) {
          await ctx.db.patientGuardian.delete({ where: { id: link.id } });
        } else {
          await ctx.db.patientGuardian.update({
            where: { id: link.id },
            data: { patientId: target.id },
          });
        }
      }

      // Re-point consents: skip types the target already holds.
      const sourceConsents = await ctx.db.patientConsent.findMany({
        where: { patientId: source.id },
      });
      for (const consent of sourceConsents) {
        const exists = await ctx.db.patientConsent.findFirst({
          where: { patientId: target.id, type: consent.type },
          select: { id: true },
        });
        if (exists) {
          await ctx.db.patientConsent.delete({ where: { id: consent.id } });
        } else {
          await ctx.db.patientConsent.update({
            where: { id: consent.id },
            data: { patientId: target.id },
          });
        }
      }

      // Allergies and medical history repoint wholesale (no uniqueness clash).
      await ctx.db.allergy.updateMany({
        where: { patientId: source.id },
        data: { patientId: target.id },
      });
      await ctx.db.medicalHistoryEntry.updateMany({
        where: { patientId: source.id },
        data: { patientId: target.id },
      });

      await this.appendTimeline(ctx, source.id, {
        type: 'patient.merged_into',
        title: `Merged into the surviving record`,
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { targetPatientId: target.id, reason },
      });
      await this.appendTimeline(ctx, target.id, {
        type: 'patient.merged_in',
        title: `Received merged record`,
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { sourcePatientId: source.id, reason },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.merge',
          resource: 'patient',
          resourceId: target.id,
          userId,
          reason,
          newState: { sourcePatientId: source.id, targetPatientId: target.id },
        },
      });
      ctx.emit({
        type: EventTypes.PatientMerged,
        aggregateType: 'patient',
        aggregateId: target.id,
        payload: { sourcePatientId: source.id, targetPatientId: target.id },
      });

      return target;
    }).then((survivor) => ({
      patient: serialize(survivor, {
        includeContact: this.mayViewContact(this.tenantContext.scope.permissions),
      }),
      source: { patientId: sourcePatientId, status: 'MERGED' as const },
      mergedIntoPatientId: targetId,
    }));
  }

  // ---------------------------------------------------------------------------
  // master record
  // ---------------------------------------------------------------------------

  async masterRecord(id: string, access?: AccessContext) {
    this.assertPatientOwnership(id);
    const organizationId = this.tenantContext.requireOrg();
    const scope = this.tenantContext.scope;
    const db = this.prisma.tenantFor(organizationId);

    const patient = await this.requirePatient(db, id);
    await this.logAccess(id, 'master', scope.userId, access);

    const [guardians, consents, allergies, medicalHistory] = await Promise.all([
      this.listGuardians(id, null),
      this.listConsents(id, null),
      this.listAllergies(id, null),
      this.listMedicalHistory(id, null),
    ]);

    return {
      patient: serialize(patient, { includeContact: this.mayViewContact(scope.permissions) }),
      sections: {
        guardians,
        consents,
        allergies,
        medicalHistory,
      },
    };
  }

  async timeline(id: string, params: { page?: number; limit?: number }, access?: AccessContext) {
    this.assertPatientOwnership(id);
    const scope = this.tenantContext.scope;
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const visible = new Set(scope.permissions);
    const where: Prisma.PatientTimelineEntryWhereInput = {
      patientId: id,
      requiredPermission: { in: [...visible] },
    };
    const [rows, total] = await Promise.all([
      db.patientTimelineEntry.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.patientTimelineEntry.count({ where }),
    ]);
    await this.logAccess(id, 'timeline', scope.userId, access);
    return pageOf(rows, total, page, limit);
  }

  async accessLog(
    id: string,
    params: { page?: number; limit?: number },
    access?: AccessContext,
  ) {
    this.assertPatientOwnership(id);
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.PatientAccessLogWhereInput = { patientId: id };
    const [rows, total] = await Promise.all([
      db.patientAccessLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.patientAccessLog.count({ where }),
    ]);
    await this.logAccess(id, 'access_log', this.tenantContext.scope.userId, access);
    return pageOf(rows, total, page, limit);
  }

  // ---------------------------------------------------------------------------
  // guardians
  // ---------------------------------------------------------------------------

  async listGuardians(patientId: string, access: AccessContext | null = null) {
    this.assertPatientOwnership(patientId);
    const db = this.prisma.tenantFor(this.tenantContext.requireOrg());
    const rows = await db.patientGuardian.findMany({
      where: { patientId },
      orderBy: { createdAt: 'asc' },
      include: { guardian: true },
    });
    if (access !== null) {
      await this.logAccess(patientId, 'guardians', this.tenantContext.scope.userId, access);
    }
    return rows;
  }

  async addGuardian(patientId: string, input: AddGuardianDto) {
    this.assertPatientOwnership(patientId);
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      await this.requirePatient(ctx.db, patientId);

      // Reuse an existing guardian with the same phone when present.
      let guardian = input.phone
        ? await ctx.db.guardian.findFirst({ where: { phone: input.phone } })
        : null;
      if (!guardian) {
        guardian = await ctx.db.guardian.create({
          data: {
            id: newId(),
            organizationId,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone ?? null,
            email: input.email ?? null,
          },
        });
      }

      const existing = await ctx.db.patientGuardian.findFirst({
        where: { patientId, guardianId: guardian.id },
      });
      if (!existing) {
        await ctx.db.patientGuardian.create({
          data: {
            id: newId(),
            organizationId,
            patientId,
            guardianId: guardian.id,
            relationship: input.relationship,
            isPrimary: input.isPrimary ?? false,
            isEmergencyContact: input.isEmergencyContact ?? false,
          },
        });
      } else {
        await ctx.db.patientGuardian.update({
          where: { id: existing.id },
          data: {
            relationship: input.relationship,
            isPrimary: input.isPrimary ?? existing.isPrimary,
            isEmergencyContact: input.isEmergencyContact ?? existing.isEmergencyContact,
          },
        });
      }

      if (input.isPrimary === true) {
        await ctx.db.patientGuardian.updateMany({
          where: { patientId, NOT: { guardianId: guardian.id } },
          data: { isPrimary: false },
        });
      }

      await this.appendTimeline(ctx, patientId, {
        type: 'patient.guardian_added',
        title: 'Guardian added',
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { guardianId: guardian.id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.guardian_added',
          resource: 'patient',
          resourceId: patientId,
          newState: { guardianId: guardian.id },
        },
      });
      ctx.emit({
        type: EventTypes.PatientGuardianAdded,
        aggregateType: 'patient',
        aggregateId: patientId,
        payload: { patientId, guardianId: guardian.id },
      });
      return guardian;
    });

    return { guardian: result };
  }

  async removeGuardian(patientId: string, guardianId: string) {
    this.assertPatientOwnership(patientId);
    const organizationId = this.tenantContext.requireOrg();

    await this.txRunner.run(async (ctx: TxContext) => {
      const link = await ctx.db.patientGuardian.findFirst({
        where: { patientId, guardianId },
      });
      if (!link) return; // idempotent removal
      await ctx.db.patientGuardian.delete({ where: { id: link.id } });
      await this.appendTimeline(ctx, patientId, {
        type: 'patient.guardian_removed',
        title: 'Guardian removed',
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { guardianId },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.guardian_removed',
          resource: 'patient',
          resourceId: patientId,
          newState: { guardianId },
        },
      });
      ctx.emit({
        type: EventTypes.PatientGuardianRemoved,
        aggregateType: 'patient',
        aggregateId: patientId,
        payload: { patientId, guardianId },
      });
    });
    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // consents
  // ---------------------------------------------------------------------------

  async listConsents(patientId: string, access: AccessContext | null = null) {
    this.assertPatientOwnership(patientId);
    const db = this.prisma.tenantFor(this.tenantContext.requireOrg());
    const rows = await db.patientConsent.findMany({
      where: { patientId },
      orderBy: { createdAt: 'asc' },
    });
    if (access !== null) {
      await this.logAccess(patientId, 'consents', this.tenantContext.scope.userId, access);
    }
    return rows;
  }

  async grantConsent(patientId: string, input: GrantConsentDto) {
    this.assertPatientOwnership(patientId);
    return this.setConsent(patientId, input.type, 'GRANTED', input.notes);
  }

  async withdrawConsent(patientId: string, type: ConsentType, input: WithdrawConsentDto) {
    this.assertPatientOwnership(patientId);
    return this.setConsent(patientId, type, 'WITHDRAWN', input.notes);
  }

  private async setConsent(
    patientId: string,
    type: ConsentType,
    status: 'GRANTED' | 'WITHDRAWN',
    notes?: string | null,
  ) {
    const organizationId = this.tenantContext.requireOrg();

    const consent = await this.txRunner.run(async (ctx: TxContext) => {
      await this.requirePatient(ctx.db, patientId);
      const now = new Date();
      const existing = await ctx.db.patientConsent.findFirst({
        where: { patientId, type },
      });

      const saved = existing
        ? await ctx.db.patientConsent.update({
            where: { id: existing.id },
            data: {
              status,
              grantedAt: status === 'GRANTED' ? now : existing.grantedAt,
              withdrawnAt: status === 'WITHDRAWN' ? now : null,
              notes: notes === undefined ? existing.notes : notes,
            },
          })
        : await ctx.db.patientConsent.create({
            data: {
              id: newId(),
              organizationId,
              patientId,
              type,
              status,
              grantedAt: status === 'GRANTED' ? now : undefined,
              withdrawnAt: status === 'WITHDRAWN' ? now : null,
              notes: notes ?? null,
              recordedByUserId: this.tenantContext.scope.userId,
            },
          });

      await this.appendTimeline(ctx, patientId, {
        type: 'patient.consent_changed',
        title: `Consent ${status === 'GRANTED' ? 'granted' : 'withdrawn'} for ${type}`,
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { type, status },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: status === 'GRANTED' ? 'patients.consent_granted' : 'patients.consent_withdrawn',
          resource: 'patient',
          resourceId: patientId,
          newState: { type, status },
        },
      });
      ctx.emit({
        type: EventTypes.PatientConsentChanged,
        aggregateType: 'patient',
        aggregateId: patientId,
        payload: { patientId, type, status },
      });
      return saved;
    });

    return { consent };
  }

  // ---------------------------------------------------------------------------
  // allergies
  // ---------------------------------------------------------------------------

  async listAllergies(patientId: string, access: AccessContext | null = null) {
    this.assertPatientOwnership(patientId);
    const db = this.prisma.tenantFor(this.tenantContext.requireOrg());
    const rows = await db.allergy.findMany({
      where: { patientId },
      orderBy: { createdAt: 'asc' },
    });
    if (access !== null) {
      await this.logAccess(patientId, 'allergies', this.tenantContext.scope.userId, access);
    }
    return rows;
  }

  async recordAllergy(patientId: string, input: AddAllergyDto) {
    this.assertPatientOwnership(patientId);
    const organizationId = this.tenantContext.requireOrg();

    const allergy = await this.txRunner.run(async (ctx: TxContext) => {
      await this.requirePatient(ctx.db, patientId);
      const created = await ctx.db.allergy.create({
        data: {
          id: newId(),
          organizationId,
          patientId,
          substance: input.substance,
          reaction: input.reaction ?? null,
          severity: input.severity,
          status: 'ACTIVE',
          notes: input.notes ?? null,
          recordedByUserId: this.tenantContext.scope.userId,
        },
      });
      await this.appendTimeline(ctx, patientId, {
        type: 'patient.allergy_recorded',
        title: `Allergy recorded: ${input.substance}`,
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { allergyId: created.id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.allergy_recorded',
          resource: 'patient',
          resourceId: patientId,
          newState: { allergyId: created.id, substance: input.substance },
        },
      });
      ctx.emit({
        type: EventTypes.PatientAllergyRecorded,
        aggregateType: 'patient',
        aggregateId: patientId,
        payload: { patientId, allergyId: created.id },
      });
      return created;
    });

    return { allergy };
  }

  async updateAllergyStatus(patientId: string, allergyId: string, input: UpdateAllergyStatusDto) {
    this.assertPatientOwnership(patientId);
    const organizationId = this.tenantContext.requireOrg();

    const allergy = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.allergy.findFirst({ where: { id: allergyId, patientId } });
      if (!current) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Allergy not found', silent: true });
      if (current.status === 'AMENDED') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'An amended allergy cannot be re-opened; record a new entry.',
          silent: true,
        });
      }
      const updated = await ctx.db.allergy.update({
        where: { id: current.id },
        data: { status: input.status },
      });
      await this.appendTimeline(ctx, patientId, {
        type: 'patient.allergy_updated',
        title: `Allergy ${input.status === 'RESOLVED' ? 'resolved' : 'reopened'}: ${current.substance}`,
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { allergyId: updated.id, status: updated.status },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.allergy_status_changed',
          resource: 'patient',
          resourceId: patientId,
          newState: { allergyId, status: input.status },
        },
      });
      return updated;
    });

    return { allergy };
  }

  async amendAllergy(patientId: string, allergyId: string, input: AmendAllergyDto) {
    this.assertPatientOwnership(patientId);
    const organizationId = this.tenantContext.requireOrg();

    const corrected = await this.txRunner.run(async (ctx: TxContext) => {
      const original = await ctx.db.allergy.findFirst({ where: { id: allergyId, patientId } });
      if (!original) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Allergy not found', silent: true });

      // Supersede the original: it is never deleted, only AMENDED.
      await ctx.db.allergy.update({
        where: { id: original.id },
        data: { status: 'AMENDED' },
      });
      const created = await ctx.db.allergy.create({
        data: {
          id: newId(),
          organizationId,
          patientId,
          substance: original.substance,
          reaction: input.reaction ?? original.reaction,
          severity: input.severity ?? original.severity,
          status: 'ACTIVE',
          notes: input.notes ?? original.notes,
          recordedByUserId: this.tenantContext.scope.userId,
          correctedById: original.id,
        },
      });
      await this.appendTimeline(ctx, patientId, {
        type: 'patient.allergy_amended',
        title: `Allergy amended: ${original.substance}`,
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { allergyId: created.id, correctedById: original.id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.allergy_amended',
          resource: 'patient',
          resourceId: patientId,
          newState: { allergyId: created.id, correctedById: original.id },
        },
      });
      return created;
    });

    return { allergy: corrected };
  }

  // ---------------------------------------------------------------------------
  // medical history
  // ---------------------------------------------------------------------------

  async listMedicalHistory(patientId: string, access: AccessContext | null = null) {
    this.assertPatientOwnership(patientId);
    const db = this.prisma.tenantFor(this.tenantContext.requireOrg());
    const rows = await db.medicalHistoryEntry.findMany({
      where: { patientId },
      orderBy: [{ onsetDate: 'asc' }, { createdAt: 'asc' }],
    });
    if (access !== null) {
      await this.logAccess(
        patientId,
        'medical_history',
        this.tenantContext.scope.userId,
        access,
      );
    }
    return rows;
  }

  async addMedicalHistory(patientId: string, input: AddMedicalHistoryDto) {
    this.assertPatientOwnership(patientId);
    const organizationId = this.tenantContext.requireOrg();

    const entry = await this.txRunner.run(async (ctx: TxContext) => {
      await this.requirePatient(ctx.db, patientId);
      const created = await ctx.db.medicalHistoryEntry.create({
        data: {
          id: newId(),
          organizationId,
          patientId,
          category: input.category,
          description: input.description,
          onsetDate: input.onsetDate ?? null,
          notes: input.notes ?? null,
          recordedByUserId: this.tenantContext.scope.userId,
        },
      });
      await this.appendTimeline(ctx, patientId, {
        type: 'patient.medical_history_added',
        title: `Medical history added (${input.category})`,
        requiredPermission: TIMELINE_VISIBLE_TO,
        payload: { entryId: created.id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'patients.medical_history_added',
          resource: 'patient',
          resourceId: patientId,
          newState: { entryId: created.id, category: input.category },
        },
      });
      ctx.emit({
        type: EventTypes.PatientMedicalHistoryAdded,
        aggregateType: 'patient',
        aggregateId: patientId,
        payload: { patientId, entryId: created.id },
      });
      return created;
    });

    return { entry };
  }

  // ---------------------------------------------------------------------------
  // shared helpers
  // ---------------------------------------------------------------------------

  private assertPatientOwnership(patientId: string): void {
    const scopePatientId = this.tenantContext.scope.patientId;
    if (scopePatientId && scopePatientId !== patientId) {
      throw new AppError({
        code: ErrorCodes.PATIENT_ACCESS_DENIED,
        message: 'A patient may only access their own record.',
        silent: true,
      });
    }
  }

  private mayViewContact(permissions: string[]): boolean {
    if (this.tenantContext.scope.patientId) return true; // own record
    return permissions.includes(PERMISSION_GROUPS.patients.update);
  }

  /** Fetch candidates for duplicate scoring by phone/email/exact name. */
  private async findCandidates(
    db: ReturnType<PrismaService['tenantFor']>,
    input: PatientKeyFacts & { firstName: string; lastName: string },
  ) {
    const or: Prisma.PatientWhereInput[] = [];
    if (input.phone) or.push({ phone: input.phone });
    if (input.email) or.push({ email: { equals: input.email, mode: 'insensitive' } });
    if (input.lastName && input.firstName) {
      or.push({
        lastName: { equals: input.lastName, mode: 'insensitive' },
        firstName: { equals: input.firstName, mode: 'insensitive' },
      });
    }
    if (or.length === 0) return [];
    return db.patient.findMany({
      where: { OR: or, status: { in: ['ACTIVE', 'MERGED'] } },
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
      },
    });
  }

  private async requirePatient(
    db: TenantClient | TxClient,
    id: string,
  ) {
    const patient = await db.patient.findFirst({ where: { id } });
    if (!patient) throw patientNotFound();
    return patient;
  }

  /** Appends an inline timeline projection entry inside the active transaction. */
  private async appendTimeline(
    ctx: TxContext,
    patientId: string,
    input: {
      type: string;
      title: string;
      requiredPermission: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await ctx.db.patientTimelineEntry.create({
      data: {
        id: newId(),
        organizationId: ctx.organizationId,
        patientId,
        type: input.type,
        title: input.title,
        requiredPermission: input.requiredPermission,
        actorId: this.tenantContext.scope.userId,
        occurredAt: new Date(),
        payload: (input.payload ?? {}) as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
  }

  private async logAccess(
    patientId: string,
    section: string,
    userId: string | null,
    access?: AccessContext,
  ): Promise<void> {
    const organizationId = this.tenantContext.requireOrg();
    const scope = this.tenantContext.scope;
    try {
      await this.prisma.tenantFor(organizationId).patientAccessLog.create({
        data: {
          id: newId(),
          organizationId,
          patientId,
          userId,
          action: 'READ',
          section,
          ip: access?.ip ?? null,
          userAgent: access?.userAgent ?? null,
          requestId: scope.requestId || null,
        },
      });
    } catch (err) {
      // Always fail open for reads; logging must never break access.
      this.logger.error(
        `Patient access-log write failed for ${patientId}/${section}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

function patientNotFound(message = 'Patient not found'): AppError {
  return new AppError({ code: ErrorCodes.PATIENT_NOT_FOUND, message, silent: true });
}

function serialize(
  patient: Patient,
  options: { includeContact: boolean } = { includeContact: false },
) {
  return {
    id: patient.id,
    patientNumber: patient.patientNumber,
    firstName: patient.firstName,
    lastName: patient.lastName,
    otherNames: patient.otherNames,
    dateOfBirth: patient.dateOfBirth,
    sex: patient.sex,
    phone: options.includeContact ? patient.phone : null,
    email: options.includeContact ? patient.email : null,
    address: options.includeContact ? patient.address : null,
    county: patient.county,
    town: patient.town,
    photoUrl: patient.photoUrl,
    status: patient.status,
    duplicateConfirmedAt: patient.duplicateConfirmedAt,
    duplicateConfirmReason: patient.duplicateConfirmReason,
    mergedIntoPatientId: patient.mergedIntoPatientId,
    version: patient.version,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
  };
}