import { Injectable } from '@nestjs/common';
import type { Complaint, ComplaintOrigin, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext, type TxClient } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import {
  assertComplaintAssignmentAllowed,
  assertComplaintClosure,
  assertComplaintTransition,
} from './domain/quality-flow';
import type {
  CreateComplaintDto,
  ListComplaintsQueryDto,
  UpdateComplaintStatusDto,
} from './dto/quality.dto';

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

async function ensureUserInOrg(db: TxClient, organizationId: string, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  if (!user) throw notFound('Assigned user not found in this organization');
}

/**
 * Complaints (brief Phase 10). Creation emits nothing by design; every status
 * change funnels through the complaint state machine and emits
 * ComplaintStatusChanged. A complaint created with an assignee opens at
 * ASSIGNED so the "assignment implies ASSIGNED/INVESTIGATING" rule holds.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateComplaintDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.scope.userId;

    const complaint = await this.txRunner.run(async (ctx: TxContext) => {
      if (input.assignedToId) {
        await ensureUserInOrg(ctx.db, organizationId, input.assignedToId);
      }
      const id = newId();
      const status = input.assignedToId ? 'ASSIGNED' : 'OPEN';
      await ctx.db.complaint.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId ?? null,
          origin: input.origin as ComplaintOrigin,
          patientId: input.patientId ?? null,
          submittedById: actorId,
          category: input.category,
          description: input.description,
          assignedToId: input.assignedToId ?? null,
          dueAt: input.dueAt ?? null,
          status,
        },
      });
      return ctx.db.complaint.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { complaint: serialize(complaint) };
  }

  async list(query: ListComplaintsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.ComplaintWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.assignedToId) where.assignedToId = query.assignedToId;

    const [rows, total] = await Promise.all([
      db.complaint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.complaint.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const complaint = await db.complaint.findFirst({ where: { id, organizationId } });
    if (!complaint) throw notFound('Complaint not found');
    return { complaint: serialize(complaint) };
  }

  async updateStatus(id: string, input: UpdateComplaintStatusDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const complaint = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.complaint.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw notFound('Complaint not found');

      const next = input.status;
      assertComplaintTransition(current.status, next);

      const appliesAssignment =
        input.assignedToId !== undefined ||
        input.dueAt !== undefined ||
        next === 'ASSIGNED';
      if (appliesAssignment) {
        assertComplaintAssignmentAllowed(next);
        if (input.assignedToId) {
          await ensureUserInOrg(ctx.db, organizationId, input.assignedToId);
        }
      }

      const effectiveResolution =
        input.resolution !== undefined && input.resolution !== null
          ? input.resolution
          : current.resolution;
      assertComplaintClosure(current.status, next, effectiveResolution);

      const data: Prisma.ComplaintUncheckedUpdateInput = { status: next };
      if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
      if (input.dueAt !== undefined) data.dueAt = input.dueAt;
      if (input.resolution !== undefined) data.resolution = input.resolution ?? null;
      if (next === 'CLOSED') {
        data.closedById = actorId;
        data.closedAt = new Date();
      }

      const updated = await ctx.db.complaint.update({ where: { id }, data });
      ctx.emit({
        type: EventTypes.ComplaintStatusChanged,
        aggregateType: 'complaint',
        aggregateId: id,
        payload: { complaintId: id, status: next },
      });
      return updated;
    });
    return { complaint: serialize(complaint) };
  }
}

export function serialize(c: Complaint) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    branchId: c.branchId,
    origin: c.origin,
    patientId: c.patientId,
    submittedById: c.submittedById,
    category: c.category,
    description: c.description,
    status: c.status,
    assignedToId: c.assignedToId,
    dueAt: c.dueAt,
    resolution: c.resolution,
    closedById: c.closedById,
    closedAt: c.closedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}