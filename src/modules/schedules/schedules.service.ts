import { Injectable } from '@nestjs/common';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { generateSlots, windowsForDay } from './domain/slots';
import { dayOfWeekForDate, startOfBusinessDay } from './domain/workweek';
import type { Prisma } from '@prisma/client';
import type {
  CreateProviderScheduleDto,
  CreateScheduleOverrideDto,
  UpdateProviderScheduleDto,
  UpdateScheduleOverrideDto,
} from './dto/schedule.dto';

/**
 * Schedules (brief Phase 3). Weekly provider templates + per-date overrides
 * produce the computed slots API used by the appointments module.
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  // ---------------------------------------------------------------------------
  // weekly templates
  // ---------------------------------------------------------------------------

  async createTemplate(input: CreateProviderScheduleDto) {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.scope.userId;

    const template = await this.txRunner.run(async (ctx: TxContext) => {
      await this.assertRefs(ctx.db, organizationId, input.branchId, input.departmentId, input.providerId);
      const created = await ctx.db.providerSchedule.create({
        data: {
          id: newId(),
          organizationId,
          providerId: input.providerId,
          branchId: input.branchId,
          departmentId: input.departmentId,
          dayOfWeek: input.dayOfWeek,
          startMinutes: input.startMinutes,
          endMinutes: input.endMinutes,
          slotDurationMinutes: input.slotDurationMinutes,
          capacity: input.capacity,
          isAvailable: input.isAvailable,
          note: input.note ?? null,
        },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'schedules.template.create',
          resource: 'provider_schedule',
          resourceId: created.id,
          userId,
          newState: {
            providerId: input.providerId,
            branchId: input.branchId,
            departmentId: input.departmentId,
            dayOfWeek: input.dayOfWeek,
          },
        },
      });
      return created;
    });

    return { schedule: template };
  }

  async updateTemplate(id: string, input: UpdateProviderScheduleDto) {
    const organizationId = this.tenantContext.requireOrg();

    const template = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.providerSchedule.findFirst({ where: { id } });
      if (!current) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Schedule not found', silent: true });
      }
      const updated = await ctx.db.providerSchedule.update({
        where: { id },
        data: {
          providerId: input.providerId ?? current.providerId,
          branchId: input.branchId ?? current.branchId,
          departmentId: input.departmentId ?? current.departmentId,
          dayOfWeek: input.dayOfWeek ?? current.dayOfWeek,
          startMinutes: input.startMinutes ?? current.startMinutes,
          endMinutes: input.endMinutes ?? current.endMinutes,
          slotDurationMinutes: input.slotDurationMinutes ?? current.slotDurationMinutes,
          capacity: input.capacity ?? current.capacity,
          isAvailable: input.isAvailable ?? current.isAvailable,
          note: input.note === undefined ? current.note : input.note,
        },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'schedules.template.update',
          resource: 'provider_schedule',
          resourceId: id,
          newState: { changed: Object.keys(input) },
        },
      });
      return updated;
    });

    return { schedule: template };
  }

  async removeTemplate(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const existing = await db.providerSchedule.findFirst({ where: { id } });
    if (!existing) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Schedule not found', silent: true });
    }
    await db.providerSchedule.delete({ where: { id } });
    return { removed: true };
  }

  async listTemplates(query: {
    providerId?: string;
    branchId?: string;
    departmentId?: string;
    dayOfWeek?: number;
    page?: number;
    limit?: number;
  }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.ProviderScheduleWhereInput = {};
    if (query.providerId) where.providerId = query.providerId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.dayOfWeek !== undefined) where.dayOfWeek = query.dayOfWeek;

    const [rows, total] = await Promise.all([
      db.providerSchedule.findMany({
        where,
        orderBy: [{ providerId: 'asc' }, { dayOfWeek: 'asc' }, { startMinutes: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.providerSchedule.count({ where }),
    ]);
    return pageOf(rows, total, page, limit);
  }

  // ---------------------------------------------------------------------------
  // per-date overrides
  // ---------------------------------------------------------------------------

  async createOverride(input: CreateScheduleOverrideDto) {
    const organizationId = this.tenantContext.requireOrg();
    const date = startOfBusinessDay(input.date);

    const override = await this.txRunner.run(async (ctx: TxContext) => {
      await this.assertRefs(ctx.db, organizationId, input.branchId, input.departmentId, input.providerId);
      const existing = await ctx.db.scheduleOverride.findFirst({
        where: { organizationId, providerId: input.providerId, date },
      });
      if (existing) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'An override already exists for this provider and date.',
          silent: true,
        });
      }
      const created = await ctx.db.scheduleOverride.create({
        data: {
          id: newId(),
          organizationId,
          providerId: input.providerId,
          branchId: input.branchId,
          departmentId: input.departmentId,
          date,
          type: input.type,
          startMinutes: input.startMinutes ?? null,
          endMinutes: input.endMinutes ?? null,
          slotDurationMinutes: input.slotDurationMinutes ?? null,
          capacity: input.capacity ?? null,
          note: input.note ?? null,
        },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'schedules.override.create',
          resource: 'schedule_override',
          resourceId: created.id,
          newState: { providerId: input.providerId, date, type: input.type },
        },
      });
      return created;
    });

    return { override };
  }

  async updateOverride(id: string, input: UpdateScheduleOverrideDto) {
    const organizationId = this.tenantContext.requireOrg();

    const override = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.scheduleOverride.findFirst({ where: { id } });
      if (!current) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Override not found', silent: true });
      }
      const updated = await ctx.db.scheduleOverride.update({
        where: { id },
        data: {
          type: input.type ?? current.type,
          startMinutes: input.startMinutes === undefined ? current.startMinutes : input.startMinutes,
          endMinutes: input.endMinutes === undefined ? current.endMinutes : input.endMinutes,
          slotDurationMinutes:
            input.slotDurationMinutes === undefined ? current.slotDurationMinutes : input.slotDurationMinutes,
          capacity: input.capacity === undefined ? current.capacity : input.capacity,
          note: input.note === undefined ? current.note : input.note,
        },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'schedules.override.update',
          resource: 'schedule_override',
          resourceId: id,
          newState: { changed: Object.keys(input) },
        },
      });
      return updated;
    });

    return { override };
  }

  async removeOverride(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const existing = await db.scheduleOverride.findFirst({ where: { id } });
    if (!existing) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Override not found', silent: true });
    }
    await db.scheduleOverride.delete({ where: { id } });
    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // computed slots
  // ---------------------------------------------------------------------------

  async listSlots(query: {
    providerId: string;
    branchId: string;
    departmentId: string;
    date: Date;
    includePast: boolean;
  }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const date = startOfBusinessDay(query.date);

    const [templates, overrides, bookings] = await Promise.all([
      db.providerSchedule.findMany({
        where: {
          organizationId,
          providerId: query.providerId,
          branchId: query.branchId,
          departmentId: query.departmentId,
          dayOfWeek: dayOfWeekForDate(date),
        },
      }),
      db.scheduleOverride.findMany({
        where: { organizationId, providerId: query.providerId, date },
      }),
      db.appointment.findMany({
        where: {
          organizationId,
          providerId: query.providerId,
          startsAt: { gte: date, lt: new Date(date.getTime() + 86_400_000) },
        },
        select: { startsAt: true, endsAt: true, status: true },
      }),
    ]);

    const slots = generateSlots({
      date,
      templates,
      overrides,
      bookings,
      includePast: query.includePast,
    });

    return { date, slots };
  }

  // ---------------------------------------------------------------------------
  // shared
  // ---------------------------------------------------------------------------

  private async assertRefs(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    branchId: string,
    departmentId: string,
    providerId: string,
  ): Promise<void> {
    const [branch, department, provider] = await Promise.all([
      db.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } }),
      db.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } }),
      db.user.findFirst({ where: { id: providerId, organizationId }, select: { id: true } }),
    ]);
    if (!branch || !department || !provider) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Branch, department or provider not found in this organization.',
        silent: true,
      });
    }
  }
}

/** Resolves the slot window (duration + capacity) that contains `startsAt`. */
export async function resolveSlotWindow(
  db: TenantClient | TxContext['db'],
  organizationId: string,
  providerId: string,
  branchId: string,
  departmentId: string,
  startsAt: Date,
): Promise<{ slotDurationMinutes: number; capacity: number } | null> {
  const date = startOfBusinessDay(startsAt);
  const [templates, overrides] = await Promise.all([
    db.providerSchedule.findMany({
      where: {
        organizationId,
        providerId,
        branchId,
        departmentId,
        dayOfWeek: dayOfWeekForDate(startsAt),
      },
    }),
    db.scheduleOverride.findMany({ where: { organizationId, providerId, date } }),
  ]);

  const windows = windowsForDay(date, templates, overrides);
  const minute = startsAt.getUTCHours() * 60 + startsAt.getUTCMinutes();
  const window = windows.find(
    (w) =>
      minute >= w.startMinutes &&
      minute + w.slotDurationMinutes <= w.endMinutes &&
      (minute - w.startMinutes) % w.slotDurationMinutes === 0,
  );
  if (!window) return null;
  return { slotDurationMinutes: window.slotDurationMinutes, capacity: window.capacity };
}