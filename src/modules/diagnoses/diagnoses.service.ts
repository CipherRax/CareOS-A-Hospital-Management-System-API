import { Injectable } from '@nestjs/common';
import type { Diagnosis, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { assertEncounterOpen } from '../encounters/domain/encounter-flow';
import { applyDiagnosisAction } from './domain/diagnosis-flow';
import type {
  CreateDiagnosisDto,
  ListDiagnosesQueryDto,
  UpdateDiagnosisDto,
} from './dto/diagnosis.dto';

/**
 * Coded diagnoses + problem lists (brief Phase 4 §6.6). A diagnosis is never
 * fabricated: it is either a coded concept from the org's imported coding
 * reference (validated against CodeConcept) or explicitly free text
 * (codeConceptId NULL). Resolved diagnoses drop off the active problem list.
 */
@Injectable()
export class DiagnosesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateDiagnosisDto) {
    const organizationId = this.tenantContext.requireOrg();
    const providerId = this.tenantContext.requireUserId();

    const diagnosis = await this.txRunner.run(async (ctx: TxContext) => {
      const encounter = await ctx.db.encounter.findFirst({
        where: { id: input.encounterId, organizationId },
      });
      if (!encounter) throw notFound('Encounter not found');
      assertEncounterOpen(encounter.status);

      let code: string | null = null;
      let codeSystemKey: string | null = null;
      let description: string;

      if (input.codeConceptId) {
        const concept = await ctx.db.codeConcept.findFirst({
          where: { id: input.codeConceptId, organizationId, isActive: true },
          include: { system: { select: { key: true } } },
        });
        if (!concept) throw notFound('Coding concept not found');
        code = concept.code;
        codeSystemKey = concept.system.key;
        description = concept.display;
      } else {
        if (!input.text) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Provide a codeConceptId or free-text diagnosis.',
            silent: true,
          });
        }
        description = input.text;
      }

      const created = await ctx.db.diagnosis.create({
        data: {
          id: newId(),
          organizationId,
          patientId: encounter.patientId,
          encounterId: input.encounterId,
          providerId,
          classification: input.classification,
          status: 'ACTIVE',
          codeConceptId: input.codeConceptId ?? null,
          code,
          codeSystemKey,
          description,
          notes: input.notes ?? null,
          onProblemList: input.onProblemList,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'diagnoses.recorded',
          resource: 'diagnosis',
          resourceId: created.id,
          newState: { description, classification: input.classification },
        },
      });
      ctx.emit({
        type: EventTypes.DiagnosisRecorded,
        aggregateType: 'diagnosis',
        aggregateId: created.id,
        payload: {
          diagnosisId: created.id,
          encounterId: input.encounterId,
          patientId: encounter.patientId,
        },
      });
      return created;
    });

    return { diagnosis: serialize(diagnosis) };
  }

  async list(query: ListDiagnosesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.DiagnosisWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.encounterId) where.encounterId = query.encounterId;
    if (query.providerId) where.providerId = query.providerId;
    if (query.classification) where.classification = query.classification;
    if (query.status) where.status = query.status;
    if (query.onProblemList !== undefined) where.onProblemList = query.onProblemList;

    const [rows, total] = await Promise.all([
      db.diagnosis.findMany({
        where,
        orderBy: [{ onProblemList: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.diagnosis.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  /** Active problem list for a patient (ACTIVE + onProblemList). */
  async problems(patientId: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const rows = await db.diagnosis.findMany({
      where: { organizationId, patientId, status: 'ACTIVE', onProblemList: true },
      orderBy: [{ classification: 'asc' }, { createdAt: 'desc' }],
    });
    return { problems: rows.map(serialize) };
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const diagnosis = await db.diagnosis.findFirst({ where: { id, organizationId } });
    if (!diagnosis) throw notFound('Diagnosis not found');
    return { diagnosis: serialize(diagnosis) };
  }

  async update(id: string, input: UpdateDiagnosisDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const diagnosis = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.diagnosis.findFirst({
        where: { id, organizationId },
        select: { id: true, status: true, classification: true, patientId: true, version: true },
      });
      if (!current) throw notFound('Diagnosis not found');

      const patch = applyDiagnosisAction(current, input.action, {
        classification: input.classification,
        resolvedNotes: input.resolvedNotes,
      });

      const updated = await ctx.db.diagnosis.update({
        where: { id },
        data: {
          ...patch,
          version: { increment: 1 },
          ...(input.action === 'resolve' ? { resolvedById: actorId } : {}),
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: input.action === 'resolve' ? 'diagnoses.resolved' : 'diagnoses.updated',
          resource: 'diagnosis',
          resourceId: id,
          newState: patch,
        },
      });
      ctx.emit({
        type: input.action === 'resolve' ? EventTypes.DiagnosisResolved : EventTypes.DiagnosisUpdated,
        aggregateType: 'diagnosis',
        aggregateId: id,
        payload: { diagnosisId: id, patientId: current.patientId },
      });
      return updated;
    });

    return { diagnosis: serialize(diagnosis) };
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serialize(d: Diagnosis) {
  return {
    id: d.id,
    organizationId: d.organizationId,
    patientId: d.patientId,
    encounterId: d.encounterId,
    providerId: d.providerId,
    classification: d.classification,
    status: d.status,
    code: d.code,
    codeSystemKey: d.codeSystemKey,
    codeConceptId: d.codeConceptId,
    description: d.description,
    notes: d.notes,
    onProblemList: d.onProblemList,
    resolvedAt: d.resolvedAt,
    resolvedById: d.resolvedById,
    resolvedNotes: d.resolvedNotes,
    version: d.version,
  };
}