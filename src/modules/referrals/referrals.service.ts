import { Injectable } from '@nestjs/common';
import type { Prisma, Referral } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import {
  assertReferralAction,
  type ReferralAction,
} from './domain/referral-flow';
import type {
  ActionReferralDto,
  CreateReferralDto,
  ListReferralsQueryDto,
} from './dto/referral.dto';

/**
 * Referrals between providers / departments or out of the facility (brief
 * Phase 4 §6.6). From-provider is the acting user; destination is either an
 * in-org department or an external facility. Every action passes the workflow
 * engine so orgs may add steps but never unlock terminal states.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(input: CreateReferralDto) {
    const organizationId = this.tenantContext.requireOrg();
    const fromProviderId = this.tenantContext.requireUserId();

    if (!input.toDepartmentId && !input.toFacilityName) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Provide toDepartmentId (in-facility) or toFacilityName (external referral).',
        silent: true,
      });
    }

    const referral = await this.txRunner.run(async (ctx: TxContext) => {
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
            message: 'Cannot create a referral against a COMPLETED encounter.',
            silent: true,
          });
        }
      }
      if (input.toDepartmentId) {
        const dept = await ctx.db.department.findFirst({
          where: { id: input.toDepartmentId, organizationId },
          select: { id: true },
        });
        if (!dept) throw notFound('Destination department not found');
      }

      const created = await ctx.db.referral.create({
        data: {
          id: newId(),
          organizationId,
          patientId: input.patientId,
          encounterId: input.encounterId ?? null,
          fromProviderId,
          toDepartmentId: input.toDepartmentId ?? null,
          toFacilityName: input.toFacilityName ?? null,
          toFacilityAddress: input.toFacilityAddress ?? null,
          reason: input.reason,
          notes: input.notes ?? null,
          documentIds: input.documentIds,
          status: 'CREATED',
        },
      });

      ctx.emit({
        type: EventTypes.ReferralCreated,
        aggregateType: 'referral',
        aggregateId: created.id,
        payload: { referralId: created.id, patientId: input.patientId },
      });
      return created;
    });

    return { referral: serialize(referral) };
  }

  async list(query: ListReferralsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.ReferralWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.encounterId) where.encounterId = query.encounterId;
    if (query.toDepartmentId) where.toDepartmentId = query.toDepartmentId;
    if (query.status) where.status = query.status;
    if (query.toFacilityName) where.toFacilityName = { contains: query.toFacilityName, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      db.referral.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      db.referral.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async action(id: string, input: ActionReferralDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const referral = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.referral.findFirst({ where: { id, organizationId } });
      if (!current) throw notFound('Referral not found');

      const target = assertReferralAction(current, input.action as ReferralAction);
      const from = current.status;
      await this.workflows.assertAllowed(ctx.db, organizationId, 'referral', from, target);

      const event = eventForAction(input.action as ReferralAction);
      if (event) {
        ctx.emit({
          type: event,
          aggregateType: 'referral',
          aggregateId: id,
          payload: {
            referralId: id,
            patientId: current.patientId,
            from,
            to: target,
            decidedById: input.action === 'accept' || input.action === 'reject' ? actorId : undefined,
          },
        });
      }

      return ctx.db.referral.update({
        where: { id },
        data: { status: target, ...applyActionFields(input, target, actorId) },
      });
    });

    return { referral: serialize(referral) };
  }
}

function applyActionFields(
  input: ActionReferralDto,
  target: string,
  actorId: string,
): Prisma.ReferralUpdateInput {
  switch (target) {
    case 'SENT':
      return { sentAt: new Date() };
    case 'ACCEPTED':
      return { acceptedAt: new Date(), decidedById: actorId };
    case 'REJECTED':
      return { rejectedAt: new Date(), decidedById: actorId, rejectReason: input.rejectReason ?? null };
    case 'COMPLETED':
      return { completedAt: new Date() };
    case 'CANCELLED':
      return { cancelledAt: new Date(), cancelReason: input.cancelReason ?? null };
    default:
      return {};
  }
}

function eventForAction(action: ReferralAction): string | null {
  switch (action) {
    case 'accept':
      return EventTypes.ReferralAccepted;
    case 'reject':
      return EventTypes.ReferralRejected;
    case 'complete':
      return EventTypes.ReferralCompleted;
    case 'cancel':
      return EventTypes.ReferralCancelled;
    case 'send':
      return null;
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serialize(r: Referral) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    patientId: r.patientId,
    encounterId: r.encounterId,
    fromProviderId: r.fromProviderId,
    toDepartmentId: r.toDepartmentId,
    toFacilityName: r.toFacilityName,
    toFacilityAddress: r.toFacilityAddress,
    reason: r.reason,
    notes: r.notes,
    documentIds: r.documentIds,
    status: r.status,
    decidedById: r.decidedById,
    sentAt: r.sentAt,
    acceptedAt: r.acceptedAt,
    rejectedAt: r.rejectedAt,
    rejectReason: r.rejectReason,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
  };
}