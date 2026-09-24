import { Injectable } from '@nestjs/common';
import type { Encounter, EncounterStatus, Prisma } from '@prisma/client';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { assertEncounterTransition } from './domain/encounter-flow';
import type {
  CreateEncounterDto,
  ListEncountersQueryDto,
  TransitionEncounterDto,
} from './dto/encounter.dto';

/**
 * Clinical encounters (brief Phase 4 §6.6). A completed encounter is locked;
 * the transition is validated centrally through the workflow engine.
 */
@Injectable()
export class EncountersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(input: CreateEncounterDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const encounter = await this.txRunner.run(async (ctx: TxContext) => {
      const patient = await ctx.db.patient.findFirst({
        where: { id: input.patientId, organizationId },
        select: { id: true },
      });
      if (!patient) {
        throw new AppError({
          code: ErrorCodes.PATIENT_NOT_FOUND,
          message: 'Patient not found',
          silent: true,
        });
      }
      const [branch, department] = await Promise.all([
        ctx.db.branch.findFirst({ where: { id: input.branchId, organizationId }, select: { id: true } }),
        ctx.db.department.findFirst({ where: { id: input.departmentId, organizationId }, select: { id: true } }),
      ]);
      if (!branch || !department) {
        throw new AppError({
          code: ErrorCodes.RESOURCE_NOT_FOUND,
          message: 'Branch or department not found.',
          silent: true,
        });
      }

      let providerId: string | null = null;
      if (input.providerId) {
        const provider = await ctx.db.user.findFirst({
          where: { id: input.providerId, organizationId },
          select: { id: true },
        });
        if (!provider) {
          throw new AppError({
            code: ErrorCodes.RESOURCE_NOT_FOUND,
            message: 'Provider not found in this organization.',
            silent: true,
          });
        }
        providerId = input.providerId;
      }

      const created = await ctx.db.encounter.create({
        data: {
          id: newId(),
          organizationId,
          branchId: input.branchId,
          departmentId: input.departmentId,
          patientId: input.patientId,
          providerId,
          type: input.type,
          status: 'OPEN',
          visitId: input.visitId ?? null,
          appointmentId: input.appointmentId ?? null,
          note: input.note ?? null,
          openedById: actorId,
          openedAt: new Date(),
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'encounters.created',
          resource: 'encounter',
          resourceId: created.id,
          newState: { patientId: input.patientId, departmentId: input.departmentId, type: input.type },
        },
      });
      ctx.emit({
        type: EventTypes.EncounterCreated,
        aggregateType: 'encounter',
        aggregateId: created.id,
        payload: { encounterId: created.id, patientId: input.patientId },
      });
      return created;
    });

    return { encounter: serializeEncounter(encounter) };
  }

  async list(query: ListEncountersQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.EncounterWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.providerId) where.providerId = query.providerId;
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.dateFrom || query.dateTo) {
      where.openedAt = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      db.encounter.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.encounter.count({ where }),
    ]);
    return pageOf(rows.map(serializeEncounter), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const encounter = await this.requireEncounter(db, organizationId, id);
    return { encounter: serializeEncounter(encounter) };
  }

  async transition(id: string, input: TransitionEncounterDto) {
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireEncounter(ctx.db, organizationId, id);
      await this.workflows.assertAllowed(
        ctx.db,
        organizationId,
        'encounter',
        current.status,
        input.status,
      );
      assertEncounterTransition(current.status, input.status);

      const now = new Date();
      const updated = await ctx.db.encounter.update({
        where: { id },
        data: {
          status: input.status,
          version: { increment: 1 },
          ...(input.status === 'COMPLETED' ? { completedAt: now } : { inProgressAt: now }),
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'encounters.transition',
          resource: 'encounter',
          resourceId: id,
          newState: { from: current.status, to: input.status },
        },
      });
      ctx.emit({
        type: eventFor(input.status),
        aggregateType: 'encounter',
        aggregateId: id,
        payload: { encounterId: id, patientId: current.patientId },
      });
      return updated;
    });

    return { encounter: serializeEncounter(result) };
  }

  private async requireEncounter(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    id: string,
  ) {
    const encounter = await db.encounter.findFirst({ where: { id, organizationId } });
    if (!encounter) throw notFound('Encounter not found');
    return encounter;
  }
}

function eventFor(status: EncounterStatus): string {
  return status === 'COMPLETED'
    ? EventTypes.EncounterCompleted
    : status === 'IN_PROGRESS'
      ? EventTypes.EncounterStarted
      : EventTypes.EncounterCreated;
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serializeEncounter(e: Encounter) {
  return {
    id: e.id,
    organizationId: e.organizationId,
    branchId: e.branchId,
    departmentId: e.departmentId,
    patientId: e.patientId,
    providerId: e.providerId,
    type: e.type,
    status: e.status,
    visitId: e.visitId,
    appointmentId: e.appointmentId,
    note: e.note,
    openedById: e.openedById,
    openedAt: e.openedAt,
    inProgressAt: e.inProgressAt,
    completedAt: e.completedAt,
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}