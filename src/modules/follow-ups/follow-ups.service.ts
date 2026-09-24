import { Injectable } from '@nestjs/common';
import type { FollowUp, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { targetStatusForAction, type FollowUpAction } from './domain/follow-up-flow';
import type {
  CreateFollowUpDto,
  ListFollowUpsQueryDto,
  TransitionFollowUpDto,
} from './dto/follow-up.dto';

/**
 * Follow-ups / return appointments (brief Phase 4 §6.6). Scheduling is an
 * open-encounter activity; completing/cancelling goes through the workflow
 * engine so orgs may add steps but never unlock terminal states.
 */
@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(input: CreateFollowUpDto) {
    const organizationId = this.tenantContext.requireOrg();
    const createdById = this.tenantContext.requireUserId();

    const followUp = await this.txRunner.run(async (ctx: TxContext) => {
      const patient = await ctx.db.patient.findFirst({
        where: { id: input.patientId, organizationId },
        select: { id: true },
      });
      if (!patient) throw notFound('Patient not found');

      if (input.encounterId) {
        const encounter = await ctx.db.encounter.findFirst({
          where: { id: input.encounterId, organizationId },
          select: { id: true, status: true },
        });
        if (!encounter) throw notFound('Encounter not found');
        if (encounter.status === 'COMPLETED') {
          throw new AppError({
            code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
            message: 'Cannot schedule a follow-up against a COMPLETED encounter.',
            silent: true,
          });
        }
      }

      const created = await ctx.db.followUp.create({
        data: {
          id: newId(),
          organizationId,
          patientId: input.patientId,
          encounterId: input.encounterId ?? null,
          providerId: input.providerId ?? null,
          departmentId: input.departmentId ?? null,
          dueAt: input.dueAt,
          reason: input.reason ?? null,
          instructions: input.instructions ?? null,
          status: 'SCHEDULED',
          createdById,
        },
      });

      ctx.emit({
        type: EventTypes.FollowUpCreated,
        aggregateType: 'follow_up',
        aggregateId: created.id,
        payload: { followUpId: created.id, patientId: input.patientId },
      });
      return created;
    });

    return { followUp: serialize(followUp) };
  }

  async list(query: ListFollowUpsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.FollowUpWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.providerId) where.providerId = query.providerId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.status = query.status;
    if (query.dueFrom || query.dueTo) {
      where.dueAt = {
        ...(query.dueFrom ? { gte: query.dueFrom } : {}),
        ...(query.dueTo ? { lte: query.dueTo } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      db.followUp.findMany({ where, orderBy: { dueAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
      db.followUp.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async transition(id: string, input: TransitionFollowUpDto) {
    const organizationId = this.tenantContext.requireOrg();

    const followUp = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireFollowUp(ctx, organizationId, id);
      const target = targetStatusForAction(current, input.action as FollowUpAction);
      const from = current.status;

      await this.workflows.assertAllowed(ctx.db, organizationId, 'follow_up', from, target);

      ctx.emit({
        type: EventTypes.FollowUpStatusChanged,
        aggregateType: 'follow_up',
        aggregateId: id,
        payload: { followUpId: id, patientId: current.patientId, from, to: target },
      });

      return ctx.db.followUp.update({
        where: { id },
        data: {
          status: target,
          ...applyTransitionFields(input, target),
        },
      });
    });

    return { followUp: serialize(followUp) };
  }

  private async requireFollowUp(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.followUp.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Follow-up not found');
    return row;
  }
}

function applyTransitionFields(
  input: TransitionFollowUpDto,
  target: string,
): Prisma.FollowUpUpdateInput {
  if (target === 'COMPLETED') {
    return { completedAt: new Date(), completedNotes: input.completedNotes ?? null };
  }
  if (target === 'CANCELLED') {
    return { cancelledAt: new Date(), cancelReason: input.cancelReason ?? null };
  }
  return {};
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serialize(f: FollowUp) {
  return {
    id: f.id,
    organizationId: f.organizationId,
    patientId: f.patientId,
    encounterId: f.encounterId,
    providerId: f.providerId,
    departmentId: f.departmentId,
    dueAt: f.dueAt,
    reason: f.reason,
    instructions: f.instructions,
    status: f.status,
    createdById: f.createdById,
    remindedAt: f.remindedAt,
    completedAt: f.completedAt,
    completedNotes: f.completedNotes,
    missedAt: f.missedAt,
    cancelledAt: f.cancelledAt,
    cancelReason: f.cancelReason,
  };
}