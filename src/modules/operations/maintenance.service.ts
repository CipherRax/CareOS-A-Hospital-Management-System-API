import { Injectable } from '@nestjs/common';
import { Prisma, type MaintenanceRecord, type MaintenanceReminder } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { EventTypes } from '../../events/catalog';
import {
  assertMaintenanceAction,
  type MaintenanceAction,
} from './domain/maintenance-flow';
import type {
  CompleteMaintenanceDto,
  ListMaintenanceQueryDto,
  ListRemindersQueryDto,
  ScheduleMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';

const REMINDER_PAST_WINDOW_MS = 24 * 3600 * 1000;
const REMINDER_FUTURE_WINDOW_MS = 72 * 3600 * 1000;

/**
 * Preventive maintenance (brief Phase 10 §7.11). An asset must be ACTIVE to be
 * scheduled; starting work flags the asset MAINTENANCE and completing (or
 * cancelling) returns it to ACTIVE. Reminders are queued as maintenance_reminders
 * rows by an idempotent scan — see docs/limitations.md for why this is a
 * queued set, not a time-based scheduler.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async schedule(input: ScheduleMaintenanceDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const record = await this.txRunner.run(async (ctx: TxContext) => {
      const asset = await ctx.db.asset.findFirst({
        where: { id: input.assetId, organizationId },
        select: { id: true, status: true },
      });
      if (!asset) throw notFound('Asset not found');
      if (asset.status !== 'ACTIVE') {
        throw new AppError({
          code: ErrorCodes.MAINTENANCE_STATE_CONFLICT,
          message: `Only ACTIVE assets can be scheduled for maintenance (asset is ${asset.status}).`,
          silent: true,
        });
      }
      const id = newId();
      await ctx.db.maintenanceRecord.create({
        data: {
          id,
          organizationId,
          assetId: input.assetId,
          scheduledFor: new Date(input.scheduledFor),
          serviceProvider: input.serviceProvider ?? null,
          notes: input.notes ?? null,
          createdById: actorId,
        },
      });
      ctx.emit({
        type: EventTypes.MaintenanceScheduled,
        aggregateType: 'maintenance',
        aggregateId: id,
        payload: { maintenanceId: id, assetId: input.assetId, scheduledFor: new Date(input.scheduledFor).toISOString() },
      });
      return ctx.db.maintenanceRecord.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { record: serialize(record) };
  }

  async list(query: ListMaintenanceQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.MaintenanceRecordWhereInput = { organizationId };
    if (query.assetId) where.assetId = query.assetId;
    if (query.status) where.status = query.status;
    if (query.upcoming) where.scheduledFor = { gte: new Date() };

    const [rows, total] = await Promise.all([
      db.maintenanceRecord.findMany({
        where,
        orderBy: { scheduledFor: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.maintenanceRecord.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const record = await this.requireOut(organizationId, id);
    return { record: serialize(record) };
  }

  async update(id: string, input: UpdateMaintenanceDto) {
    const organizationId = this.tenantContext.requireOrg();
    const record = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertMaintenanceAction(current, 'reschedule');
      if (input.version !== undefined && Number(input.version) !== current.version) {
        throw versionConflict();
      }
      return ctx.db.maintenanceRecord.update({
        where: { id: current.id },
        data: {
          ...(input.scheduledFor !== undefined ? { scheduledFor: new Date(input.scheduledFor) } : {}),
          ...(input.serviceProvider !== undefined ? { serviceProvider: input.serviceProvider } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          version: { increment: 1 },
        },
      });
    });
    return { record: serialize(record) };
  }

  /** Start work: PLANNED -> IN_PROGRESS and flag the asset MAINTENANCE. */
  async start(id: string) {
    const record = await this.transition(id, 'start', async (ctx, current) => {
      await this.flagAsset(ctx, current.assetId, 'MAINTENANCE');
      return ctx.db.maintenanceRecord.update({
        where: { id: current.id },
        data: { status: 'IN_PROGRESS', version: { increment: 1 } },
      });
    });
    return { record: serialize(record) };
  }

  /** Complete work: record downtime/cost and return the asset to service. */
  async complete(id: string, input: CompleteMaintenanceDto) {
    const actorId = this.tenantContext.requireUserId();
    const record = await this.transition(id, 'complete', async (ctx, current) => {
      await this.flagAsset(ctx, current.assetId, 'ACTIVE');
      return ctx.db.maintenanceRecord.update({
        where: { id: current.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedById: actorId,
          downtimeHours: input.downtimeHours ?? null,
          cost: input.cost !== undefined ? toMoney(input.cost) : null,
          serviceProvider: input.serviceProvider !== undefined ? input.serviceProvider : current.serviceProvider,
          notes: input.notes !== undefined ? input.notes : current.notes,
          version: { increment: 1 },
        },
      });
    });
    return { record: serialize(record) };
  }

  /** Cancel a not-yet-completed job and return the asset to service. */
  async cancel(id: string) {
    const actorId = this.tenantContext.requireUserId();
    const record = await this.transition(id, 'cancel', async (ctx, current) => {
      await this.flagAsset(ctx, current.assetId, 'ACTIVE');
      return ctx.db.maintenanceRecord.update({
        where: { id: current.id },
        data: {
          status: 'CANCELLED',
          cancelledById: actorId,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
    });
    return { record: serialize(record) };
  }

  /** Flip an asset's operational status (guards re-flipping identical values). */
  private async flagAsset(ctx: TxContext, assetId: string, status: 'ACTIVE' | 'MAINTENANCE'):
    Promise<void> {
    const asset = await ctx.db.asset.findUnique({ where: { id: assetId }, select: { id: true, status: true } });
    if (!asset) return;
    if (asset.status === status) return;
    await ctx.db.asset.update({ where: { id: asset.id }, data: { status } });
  }

  /**
   * Idempotent reminder queueing. Scans PLANNED/IN_PROGRESS records inside the
   * reminder horizon and materialises exactly one MaintenanceReminder per
   * record (unique organizationId+maintenanceId). Safe to run on a cadence.
   */
  async queueReminders() {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const now = Date.now();
    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const candidates = await ctx.db.maintenanceRecord.findMany({
        where: {
          organizationId,
          status: { in: ['PLANNED', 'IN_PROGRESS'] },
          scheduledFor: {
            gte: new Date(now - REMINDER_PAST_WINDOW_MS),
            lte: new Date(now + REMINDER_FUTURE_WINDOW_MS),
          },
        },
        select: { id: true, scheduledFor: true },
        orderBy: { scheduledFor: 'asc' },
      });
      let queued = 0;
      let skipped = 0;
      for (const candidate of candidates) {
        const existing = await ctx.db.maintenanceReminder.findUnique({
          where: { organizationId_maintenanceId: { organizationId, maintenanceId: candidate.id } },
          select: { id: true },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
        const id = newId();
        await ctx.db.maintenanceReminder.create({
          data: {
            id,
            organizationId,
            maintenanceId: candidate.id,
            dueAt: candidate.scheduledFor,
            queuedById: actorId,
          },
        });
        queued += 1;
        ctx.emit({
          type: EventTypes.MaintenanceReminderQueued,
          aggregateType: 'maintenance',
          aggregateId: id,
          payload: { reminderId: id, maintenanceId: candidate.id, dueAt: candidate.scheduledFor.toISOString() },
        });
      }
      return { queued, skipped };
    });
    return result;
  }

  async listReminders(query: ListRemindersQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.MaintenanceReminderWhereInput = { organizationId };
    if (query.status) where.status = query.status;
    if (query.assetId) {
      where.maintenance = { assetId: query.assetId };
    }

    const [rows, total] = await Promise.all([
      db.maintenanceReminder.findMany({
        where,
        include: { maintenance: true },
        orderBy: { dueAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.maintenanceReminder.count({ where }),
    ]);
    return pageOf(rows.map(serializeReminder), total, page, limit);
  }

  /** Mark a queued reminder as delivered (structural stub, see limitations). */
  async markReminderSent(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const reminder = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.maintenanceReminder.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw notFound('Reminder not found');
      if (current.status !== 'QUEUED') return current;
      return ctx.db.maintenanceReminder.update({
        where: { id: current.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    });
    return { reminder: serializeReminder(reminder) };
  }

  private async requireIn(ctx: TxContext, organizationId: string, id: string): Promise<MaintenanceRecord> {
    const record = await ctx.db.maintenanceRecord.findFirst({ where: { id, organizationId } });
    if (!record) throw notFound('Maintenance record not found');
    return record;
  }

  private async requireOut(organizationId: string, id: string): Promise<MaintenanceRecord> {
    const record = await this.prisma.tenantFor(organizationId).maintenanceRecord.findFirst({
      where: { id, organizationId },
    });
    if (!record) throw notFound('Maintenance record not found');
    return record;
  }

  private async transition(
    id: string,
    action: MaintenanceAction,
    apply: (ctx: TxContext, current: MaintenanceRecord) => Promise<MaintenanceRecord>,
  ) {
    const organizationId = this.tenantContext.requireOrg();
    return this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertMaintenanceAction(current, action);
      const updated = await apply(ctx, current);
      ctx.emit({
        type:
          action === 'complete'
            ? EventTypes.MaintenanceCompleted
            : EventTypes.MaintenanceStatusChanged,
        aggregateType: 'maintenance',
        aggregateId: current.id,
        payload: {
          maintenanceId: current.id,
          status: updated.status,
          assetId: current.assetId,
        },
      });
      return updated;
    });
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function versionConflict(): AppError {
  return new AppError({
    code: ErrorCodes.VERSION_CONFLICT,
    message: 'This maintenance record was modified by someone else. Reload and retry.',
    silent: true,
  });
}

function toMoney(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

function serialize(r: MaintenanceRecord) {
  return {
    id: r.id,
    organizationId: r.organizationId,
    assetId: r.assetId,
    status: r.status,
    scheduledFor: r.scheduledFor,
    completedAt: r.completedAt,
    downtimeHours: r.downtimeHours,
    cost: r.cost === null ? null : r.cost.toFixed(2),
    serviceProvider: r.serviceProvider,
    notes: r.notes,
    version: r.version,
    createdById: r.createdById,
    completedById: r.completedById,
    cancelledById: r.cancelledById,
    cancelledAt: r.cancelledAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function serializeReminder(rr: MaintenanceReminder & { maintenance?: MaintenanceRecord | null }) {
  return {
    id: rr.id,
    organizationId: rr.organizationId,
    maintenanceId: rr.maintenanceId,
    dueAt: rr.dueAt,
    status: rr.status,
    queuedById: rr.queuedById,
    queuedAt: rr.queuedAt,
    sentAt: rr.sentAt,
    maintenance: rr.maintenance ? serialize(rr.maintenance) : null,
  };
}