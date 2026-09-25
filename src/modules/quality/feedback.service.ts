import { Injectable } from '@nestjs/common';
import type { Feedback, FeedbackCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { assertFeedbackRespondRules } from './domain/quality-flow';
import type {
  ListFeedbackQueryDto,
  RespondFeedbackDto,
} from './dto/quality.dto';

export interface SubmitFeedbackInput {
  branchId?: string | null;
  category: FeedbackCategory;
  rating: number;
  comment?: string | null;
  patientId?: string | null;
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

/**
 * Feedback (brief Phase 10). A patient principal may only ever submit against
 * its own self-scope (the portal passes patientId=scope.patientId and the
 * service re-enforces it). Staff submissions record submittedById; patient
 * submissions rely on the audit actorId attached by TxRunner.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async submit(input: SubmitFeedbackInput) {
    const organizationId = this.tenantContext.requireOrg();
    const scope = this.tenantContext.scope;
    const isPatientPrincipal =
      scope.patientId !== null && scope.patientId !== undefined;

    // Patient principals can never submit on behalf of someone else.
    const patientId = isPatientPrincipal ? scope.patientId : input.patientId ?? null;
    const submittedById = isPatientPrincipal ? null : scope.userId;

    const feedback = await this.txRunner.run(async (ctx: TxContext) => {
      const id = newId();
      await ctx.db.feedback.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId ?? null,
          patientId,
          submittedById,
          category: input.category,
          rating: input.rating,
          comment: input.comment ?? null,
          status: 'NEW',
        },
      });
      ctx.emit({
        type: EventTypes.FeedbackSubmitted,
        aggregateType: 'feedback',
        aggregateId: id,
        payload: { feedbackId: id },
      });
      return ctx.db.feedback.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { feedback: serialize(feedback) };
  }

  async list(query: ListFeedbackQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.FeedbackWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      db.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.feedback.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const feedback = await db.feedback.findFirst({ where: { id, organizationId } });
    if (!feedback) throw notFound('Feedback not found');
    return { feedback: serialize(feedback) };
  }

  async respond(id: string, input: RespondFeedbackDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const feedback = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.feedback.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw notFound('Feedback not found');

      const next = input.status;
      assertFeedbackRespondRules({
        current: current.status,
        next,
        response: input.response ?? null,
        existingResponse: current.response,
      });

      const response =
        input.response !== undefined && input.response !== null
          ? input.response
          : (current.response ?? null);

      return ctx.db.feedback.update({
        where: { id },
        data: {
          status: next,
          response,
          handledById: actorId,
          handledAt: new Date(),
        },
      });
    });
    return { feedback: serialize(feedback) };
  }
}

export function serialize(f: Feedback) {
  return {
    id: f.id,
    organizationId: f.organizationId,
    branchId: f.branchId,
    patientId: f.patientId,
    submittedById: f.submittedById,
    category: f.category,
    rating: f.rating,
    comment: f.comment,
    status: f.status,
    response: f.response,
    handledById: f.handledById,
    handledAt: f.handledAt,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}