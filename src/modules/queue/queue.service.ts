import { Injectable } from '@nestjs/common';
import type { OperationalPriority, QueueEntry, QueueStatus } from '@prisma/client';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { RealtimeService } from '../../database/realtime.service';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { startOfBusinessDay } from '../schedules/domain/workweek';
import {
  assertQueueTransition,
  ACTIVE_QUEUE_STATUSES,
  assertVisitTransition,
} from './domain/queue-flow';
import { formatTicket, nextQueueSequence, ticketPrefixFor } from './domain/ticket';
import { computeQueueStats, estimateWaitMinutes, peopleAhead } from './domain/metrics';
import type {
  CreateQueueEntryDto,
  RegisterWalkInDto,
  UpdateQueueEntryStatusDto,
  UpdateQueuePriorityDto,
  UpdateVisitStatusDto,
} from './dto/queue.dto';

/**
 * Waiting-room queues + the visit journey (brief Phase 3, §6.5). One queue per
 * (branch, department, business-day); ticket numbers come from the locked
 * counters table. Transfers produce a TRANSFERRED row here and a fresh WAITING
 * row at the target department, all in one transaction. Realtime events on the
 * `queue` topic carry ticket numbers only (never patient identifiers).
 */
@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // registration / enqueue
  // ---------------------------------------------------------------------------

  async registerWalkIn(input: RegisterWalkInDto) {
    const organizationId = this.tenantContext.requireOrg();
    const branchId = input.branchId ?? (await this.defaultBranch(organizationId, input.departmentId));

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      await this.assertPatientAndDepartment(
        ctx.db,
        organizationId,
        input.patientId,
        branchId,
        input.departmentId,
      );

      const active = await ctx.db.visit.findFirst({
        where: {
          organizationId,
          patientId: input.patientId,
          status: { not: 'COMPLETED' },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (active) {
        throw new AppError({
          code: ErrorCodes.VISIT_ALREADY_ACTIVE,
          message: 'This patient already has an open visit.',
          silent: true,
        });
      }

      const visit = await ctx.db.visit.create({
        data: {
          id: newId(),
          organizationId,
          branchId,
          departmentId: input.departmentId,
          patientId: input.patientId,
          source: input.source,
          status: 'REGISTERED',
          registeredById: this.tenantContext.scope.userId,
          registeredAt: new Date(),
        },
      });

      const queued = await this.enqueue(ctx, organizationId, {
        visitId: visit.id,
        patientId: input.patientId,
        branchId,
        departmentId: input.departmentId,
        priority: input.priority,
        note: input.note,
      });

      ctx.emit({
        type: EventTypes.VisitStatusChanged,
        aggregateType: 'visit',
        aggregateId: visit.id,
        payload: { visitId: visit.id, patientId: input.patientId, status: visit.status },
      });
      return { visit, queued };
    });

    this.publish(organizationId, {
      event: EventTypes.QueueEntryCreated,
      aggregateId: result.queued.queueEntry.id,
      payload: { ticketNumber: result.queued.queueEntry.ticketNumber, departmentId: input.departmentId },
    });
    return {
      ticketNumber: result.queued.queueEntry.ticketNumber,
      visitId: result.visit.id,
      position: result.queued.positionAhead,
      status: result.queued.queueEntry.status,
    };
  }

  async createQueueEntry(input: CreateQueueEntryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const branchId = input.branchId ?? (await this.defaultBranch(organizationId, input.departmentId));

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      await this.assertPatientAndDepartment(
        ctx.db,
        organizationId,
        input.patientId,
        branchId,
        input.departmentId,
      );

      const visit = await ctx.db.visit.findFirst({
        where: { organizationId, patientId: input.patientId, status: { not: 'COMPLETED' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!visit) {
        throw new AppError({
          code: ErrorCodes.VISIT_ALREADY_ACTIVE,
          message: 'No active visit for this patient.',
          silent: true,
        });
      }

      const activeEntry = await ctx.db.queueEntry.findFirst({
        where: {
          organizationId,
          patientId: input.patientId,
          departmentId: input.departmentId,
          status: { in: [...ACTIVE_QUEUE_STATUSES] },
        },
        select: { id: true },
      });
      if (activeEntry) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'Patient already has an active queue entry in this department.',
          silent: true,
        });
      }

      const queued = await this.enqueue(ctx, organizationId, {
        visitId: visit.id,
        patientId: input.patientId,
        branchId,
        departmentId: input.departmentId,
        priority: input.priority,
        note: input.note,
      });

      await ctx.db.visit.update({
        where: { id: visit.id },
        data: { currentQueueEntryId: queued.queueEntry.id },
      });
      return { visit, queued };
    });

    this.publish(organizationId, {
      event: EventTypes.QueueEntryCreated,
      aggregateId: result.queued.queueEntry.id,
      payload: { ticketNumber: result.queued.queueEntry.ticketNumber, departmentId: input.departmentId },
    });
    return {
      ticketNumber: result.queued.queueEntry.ticketNumber,
      visitId: result.visit.id,
      position: result.queued.positionAhead,
      status: result.queued.queueEntry.status,
    };
  }

  private async enqueue(
    ctx: TxContext,
    organizationId: string,
    input: {
      visitId: string;
      patientId: string;
      branchId: string;
      departmentId: string;
      priority: OperationalPriority;
      note?: string;
    },
  ) {
    const now = new Date();
    const queueDate = startOfBusinessDay(now);

    const department = await ctx.db.department.findUniqueOrThrow({
      where: { id: input.departmentId },
      select: { name: true },
    });
    const prefix = ticketPrefixFor(department.name);
    const baseSeq = await nextQueueSequence(
      ctx.db,
      organizationId,
      input.branchId,
      input.departmentId,
      queueDate,
    );

    let ticketNumber = '';
    for (let attempt = 0; ; attempt += 1) {
      ticketNumber = formatTicket(prefix, baseSeq + BigInt(attempt));
      const existing = await ctx.db.queueEntry.findFirst({
        where: {
          organizationId,
          branchId: input.branchId,
          departmentId: input.departmentId,
          queueDate,
          ticketNumber,
        },
        select: { id: true },
      });
      if (!existing) break;
      if (attempt > 10) {
        throw new AppError({ code: ErrorCodes.CONFLICT, message: 'Ticket sequence exhausted.', silent: true });
      }
    }

    const row = await ctx.db.queueEntry.create({
      data: {
        id: newId(),
        organizationId,
        branchId: input.branchId,
        departmentId: input.departmentId,
        visitId: input.visitId,
        patientId: input.patientId,
        queueDate,
        prefix,
        ticketNumber,
        operationalPriority: input.priority,
        status: 'WAITING',
        enteredAt: now,
        note: input.note ?? null,
      },
    });

    await this.appendTimeline(ctx, input.patientId, {
      type: 'queue.registered',
      title: `Added to the ${department.name} queue`,
      requiredPermission: 'queue.read',
      payload: { ticketNumber, departmentId: input.departmentId },
    });
    await ctx.db.auditLog.create({
      data: {
        id: newId(),
        organizationId,
        action: 'queue.entry_created',
        resource: 'queue_entry',
        resourceId: row.id,
        newState: { ticketNumber, departmentId: input.departmentId },
      },
      select: { id: true },
    });

    const positionAhead = await this.positionAhead(ctx.db, organizationId, row);
    return { queueEntry: row, positionAhead };
  }

  // ---------------------------------------------------------------------------
  // queue-entry lifecycle
  // ---------------------------------------------------------------------------

  async updateQueueEntryStatus(id: string, input: UpdateQueueEntryStatusDto) {
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const entry = await ctx.db.queueEntry.findFirst({ where: { id, organizationId } });
      if (!entry) {
        throw new AppError({
          code: ErrorCodes.RESOURCE_NOT_FOUND,
          message: 'Queue entry not found.',
          silent: true,
        });
      }
      assertQueueTransition(entry.status, input.status);

      const now = new Date();
      const data: Record<string, unknown> = { status: input.status };
      if (input.status === 'CALLED') {
        data.calledAt = now;
        data.calledByUserId = this.tenantContext.scope.userId ?? entry.calledByUserId;
      }
      if (input.status === 'IN_SERVICE') data.serviceStartedAt = now;
      if (input.status === 'COMPLETED') data.completedAt = now;
      if (input.status === 'NO_SHOW') data.noShowAt = now;
      if (input.status === 'TRANSFERRED') {
        data.transferredToId = input.transferredToDepartmentId ?? null;
        data.transferReason = input.reason ?? null;
      }

      const updated = await ctx.db.queueEntry.update({ where: { id }, data });

      if (entry.visitId && !ACTIVE_QUEUE_STATUSES.has(input.status)) {
        await ctx.db.visit.updateMany({
          where: { id: entry.visitId, currentQueueEntryId: entry.id },
          data: { currentQueueEntryId: null },
        });
      }

      if (input.status === 'TRANSFERRED' && input.transferredToDepartmentId) {
        await this.forwardTransfer(ctx, organizationId, entry, input, now);
      }

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'queue.entry_status',
          resource: 'queue_entry',
          resourceId: id,
          newState: {
            from: entry.status,
            to: input.status,
            reason: input.reason ?? null,
            transferredToDepartmentId: input.transferredToDepartmentId ?? null,
          },
        },
        select: { id: true },
      });
      return { entry, updated };
    });

    this.publish(organizationId, {
      event: eventForQueueStatus(input.status),
      aggregateId: id,
      payload: {
        ticketNumber: result.entry.ticketNumber,
        departmentId: result.entry.departmentId,
        status: input.status,
      },
    });
    return { status: input.status, ticketNumber: result.entry.ticketNumber };
  }

  /** Creates the fresh WAITING row at the transfer target inside the same tx. */
  private async forwardTransfer(
    ctx: TxContext,
    organizationId: string,
    source: QueueEntry,
    input: UpdateQueueEntryStatusDto,
    now: Date,
  ) {
    const targetDeptId = input.transferredToDepartmentId!;
    const targetBranchId = input.transferredToBranchId ?? source.branchId;

    const targetDept = await ctx.db.department.findUniqueOrThrow({
      where: { id: targetDeptId },
      select: { name: true },
    });
    const target = await ctx.db.queueEntry.create({
      data: {
        id: newId(),
        organizationId,
        branchId: targetBranchId,
        departmentId: targetDeptId,
        visitId: source.visitId,
        patientId: source.patientId,
        queueDate: startOfBusinessDay(now),
        prefix: ticketPrefixFor(targetDept.name),
        ticketNumber: source.ticketNumber,
        operationalPriority: source.operationalPriority,
        status: 'WAITING',
        enteredAt: now,
        transferredFromId: source.id,
        note: input.reason ?? null,
      },
    });
    if (source.visitId) {
      await ctx.db.visit.updateMany({
        where: { id: source.visitId },
        data: { currentQueueEntryId: target.id },
      });
    }
    await this.appendTimeline(ctx, source.patientId, {
      type: 'queue.transferred',
      title: 'Re-queued at another department',
      requiredPermission: 'queue.read',
      payload: { ticketNumber: target.ticketNumber, departmentId: targetDeptId },
    });
    await ctx.db.auditLog.create({
      data: {
        id: newId(),
        organizationId,
        action: 'queue.entry_transferred',
        resource: 'queue_entry',
        resourceId: target.id,
        newState: { fromEntryId: source.id, ticketNumber: target.ticketNumber },
      },
      select: { id: true },
    });
  }

  async updatePriority(id: string, input: UpdateQueuePriorityDto) {
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.queueEntry.findFirst({ where: { id, organizationId } });
      if (!current) {
        throw new AppError({
          code: ErrorCodes.RESOURCE_NOT_FOUND,
          message: 'Queue entry not found.',
          silent: true,
        });
      }
      if (!ACTIVE_QUEUE_STATUSES.has(current.status)) {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'Only active queue entries can be reprioritised.',
          silent: true,
        });
      }
      const updated = await ctx.db.queueEntry.update({
        where: { id },
        data: { operationalPriority: input.operationalPriority },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'queue.entry_priority',
          resource: 'queue_entry',
          resourceId: id,
          newState: {
            from: current.operationalPriority,
            to: input.operationalPriority,
            reason: input.reason ?? null,
          },
        },
        select: { id: true },
      });
      return { previous: current, updated };
    });

    this.publish(organizationId, {
      event: EventTypes.QueueEntryPriorityChanged,
      aggregateId: id,
      payload: { ticketNumber: result.previous.ticketNumber, priority: input.operationalPriority },
    });
    return { priority: input.operationalPriority };
  }

  async updateVisitStatus(visitId: string, input: UpdateVisitStatusDto) {
    const organizationId = this.tenantContext.requireOrg();

    await this.txRunner.run(async (ctx: TxContext) => {
      const visit = await ctx.db.visit.findFirst({ where: { id: visitId, organizationId } });
      if (!visit) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Visit not found.', silent: true });
      }
      assertVisitTransition(visit.status, input.status);

      const now = new Date();
      const data: Record<string, unknown> = { status: input.status };
      if (input.status === 'CHECKED_IN') data.checkedInAt = now;
      if (input.status === 'TRIAGE') data.triageAt = now;
      if (input.status === 'CONSULTATION') data.providerStartedAt = now;
      if (input.status === 'COMPLETED') data.completedAt = now;

      const updated = await ctx.db.visit.update({ where: { id: visitId }, data });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'queue.visit_status',
          resource: 'visit',
          resourceId: visitId,
          newState: { from: visit.status, to: input.status, reason: input.reason ?? null },
        },
        select: { id: true },
      });
      ctx.emit({
        type: EventTypes.VisitStatusChanged,
        aggregateType: 'visit',
        aggregateId: visitId,
        payload: { visitId, patientId: visit.patientId, status: input.status },
      });
      return { visit, updated };
    });

    this.publish(organizationId, {
      event: EventTypes.VisitStatusChanged,
      aggregateId: visitId,
      payload: { visitId, status: input.status },
    });
    return { visitId, status: input.status };
  }

  // ---------------------------------------------------------------------------
  // queries
  // ---------------------------------------------------------------------------

  async list(query: {
    departmentId?: string;
    branchId?: string;
    status?: string;
    queueDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Record<string, unknown> = {};
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status as QueueStatus;
    if (query.queueDate) where.queueDate = startOfBusinessDay(query.queueDate);

    const [rows, total] = await Promise.all([
      db.queueEntry.findMany({
        where,
        orderBy: [{ queueDate: 'desc' }, { enteredAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      }),
      db.queueEntry.count({ where }),
    ]);
    return pageOf(
      rows.map((r) => ({
        id: r.id,
        ticketNumber: r.ticketNumber,
        branchId: r.branchId,
        departmentId: r.departmentId,
        patientId: r.patientId,
        visitId: r.visitId,
        patient: r.patient ? `${r.patient.firstName} ${r.patient.lastName}` : null,
        status: r.status,
        operationalPriority: r.operationalPriority,
        enteredAt: r.enteredAt,
        calledAt: r.calledAt,
        serviceStartedAt: r.serviceStartedAt,
        completedAt: r.completedAt,
        note: r.note,
      })),
      total,
      page,
      limit,
    );
  }

  /** Self-service digital-queue status (patient-scoped via TenantScope). */
  async status() {
    const organizationId = this.tenantContext.requireOrg();
    const patientId = this.tenantContext.scope.patientId;
    if (!patientId) {
      throw new AppError({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'A patient scope is required.',
        silent: true,
      });
    }
    const db = this.prisma.tenantFor(organizationId);
    const entry = await db.queueEntry.findFirst({
      where: {
        organizationId,
        patientId,
        status: { in: [...ACTIVE_QUEUE_STATUSES] },
      },
      orderBy: { enteredAt: 'desc' },
    });
    if (!entry) {
      return { queued: false, ticketNumber: null, position: null, estimate: null };
    }

    const window = await db.queueEntry.findMany({
      where: { organizationId, departmentId: entry.departmentId, queueDate: entry.queueDate },
      select: {
        id: true,
        ticketNumber: true,
        enteredAt: true,
        operationalPriority: true,
        status: true,
        calledAt: true,
        serviceStartedAt: true,
        completedAt: true,
        noShowAt: true,
      },
    });
    const stats = computeQueueStats(window);
    const ahead = peopleAhead(window, entry.id);
    return {
      queued: true,
      ticketNumber: entry.ticketNumber,
      status: entry.status,
      departmentId: entry.departmentId,
      position: ahead,
      estimate: estimateWaitMinutes(
        { avgServiceMinutes: stats.avgServiceMinutes },
        ahead,
        stats.avgCallWaitMinutes,
      ),
    };
  }

  async metrics(query: { departmentId?: string; queueDate?: Date; limit?: number }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const where: Record<string, unknown> = {};
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.queueDate) where.queueDate = startOfBusinessDay(query.queueDate);
    const rows = await db.queueEntry.findMany({
      where,
      take: query.limit ? Math.min(query.limit, 5000) : 5000,
      select: {
        status: true,
        enteredAt: true,
        calledAt: true,
        serviceStartedAt: true,
        completedAt: true,
        noShowAt: true,
      },
    });
    return { stats: computeQueueStats(rows) };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private async positionAhead(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    entry: QueueEntry,
  ): Promise<number> {
    const rows = await db.queueEntry.findMany({
      where: { organizationId, departmentId: entry.departmentId, queueDate: entry.queueDate },
      select: { id: true, ticketNumber: true, enteredAt: true, operationalPriority: true, status: true },
    });
    return peopleAhead(rows, entry.id);
  }

  private async assertPatientAndDepartment(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    patientId: string,
    branchId: string,
    departmentId: string,
  ) {
    const [patient, branch, department] = await Promise.all([
      db.patient.findFirst({ where: { id: patientId, organizationId }, select: { id: true } }),
      db.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } }),
      db.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } }),
    ]);
    if (!patient) {
      throw new AppError({ code: ErrorCodes.PATIENT_NOT_FOUND, message: 'Patient not found.', silent: true });
    }
    if (!branch || !department) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Branch or department not found.', silent: true });
    }
  }

  private async defaultBranch(organizationId: string, _departmentId: string): Promise<string> {
    const db = this.prisma.tenantFor(organizationId);
    const userId = this.tenantContext.scope.userId;
    const assigned = userId
      ? await db.userBranch.findFirst({
          where: { organizationId, userId },
          select: { branchId: true },
          orderBy: { createdAt: 'asc' },
        })
      : null;
    if (assigned) return assigned.branchId;
    const first = await db.branch.findFirst({
      where: { organizationId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!first) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'No branch found.', silent: true });
    }
    return first.id;
  }

  private async appendTimeline(
    ctx: TxContext,
    patientId: string,
    input: { type: string; title: string; requiredPermission: string; payload: Record<string, unknown> },
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
        payload: input.payload as never,
      },
      select: { id: true },
    });
  }

  private publish(
    organizationId: string,
    event: { event: string; aggregateId: string; payload: Record<string, unknown> },
  ): void {
    this.realtime.publish(organizationId, 'queue', { version: 1, ...event });
  }
}

function eventForQueueStatus(status: QueueStatus): string {
  switch (status) {
    case 'CALLED':
      return EventTypes.QueueEntryCalled;
    case 'IN_SERVICE':
      return EventTypes.QueueEntryStarted;
    case 'COMPLETED':
      return EventTypes.QueueEntryCompleted;
    case 'NO_SHOW':
      return EventTypes.QueueEntryNoShow;
    case 'TRANSFERRED':
      return EventTypes.QueueEntryTransferred;
    default:
      return EventTypes.QueueEntryCreated;
  }
}