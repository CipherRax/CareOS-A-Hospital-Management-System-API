import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { RealtimeService } from '../../database/realtime.service';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import type { Appointment, AppointmentMode, Prisma, WaitlistEntry } from '@prisma/client';
import { resolveSlotWindow } from '../schedules/schedules.service';
import { assertAppointmentTransition, TERMINAL_APPOINTMENT_STATUSES } from './domain/appointment-flow';
import { parseOrgSettings } from './domain/org-settings';
import type {
  AcceptWaitlistOfferDto,
  BookAppointmentDto,
  CancelAppointmentDto,
  JoinWaitlistDto,
  RescheduleAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointment.dto';

/**
 * Appointments + waitlist (brief Phase 3, §6.4/§6.5). Booking is serialized
 * with a Postgres advisory transaction lock keyed to (org, provider, slot).
 * Capacity-aware: several appointments may share a slot window when scheduled
 * capacity > 1; concurrent double-bookings get exactly one winner and the rest
 * APPOINTMENT_CONFLICT.
 */
@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // booking
  // ---------------------------------------------------------------------------

  async book(input: BookAppointmentDto) {
    const organizationId = this.tenantContext.requireOrg();

    const appointment = await this.txRunner.run(async (ctx: TxContext) => {
      return this.createBooking(ctx, organizationId, {
        patientId: input.patientId,
        providerId: input.providerId,
        branchId: input.branchId,
        departmentId: input.departmentId,
        startsAt: input.startsAt,
        mode: input.mode,
        appointmentType: input.appointmentType,
        reason: input.reason,
      });
    });

    this.publish(organizationId, 'appointments', {
      event: EventTypes.AppointmentBooked,
      aggregateId: appointment.id,
      payload: { appointmentId: appointment.id, status: appointment.status },
    });

    return { appointment: serializeAppointment(appointment) };
  }

  /** Shared booking path (public book, reschedule target, waitlist accept). */
  private async createBooking(
    ctx: TxContext,
    organizationId: string,
    input: {
      patientId: string;
      providerId: string;
      branchId: string;
      departmentId: string;
      startsAt: Date;
      mode: AppointmentMode;
      appointmentType?: string;
      reason?: string;
      rescheduledFromId?: string;
    },
  ): Promise<Appointment> {
    await this.assertPatientAndProvider(
      ctx.db,
      organizationId,
      input.patientId,
      input.providerId,
    );

    // Serialize concurrent bookings of the SAME slot via an advisory xact lock.
    const lockKey = `${organizationId}:${input.providerId}:${input.startsAt.getTime()}`;
    await ctx.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const window = await resolveSlotWindow(
      ctx.db,
      organizationId,
      input.providerId,
      input.branchId,
      input.departmentId,
      input.startsAt,
    );
    if (!window) {
      throw conflict('The requested time is not a bookable slot.');
    }

    const occupying = await ctx.db.appointment.count({
      where: {
        organizationId,
        providerId: input.providerId,
        startsAt: input.startsAt,
        status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
      },
    });
    if (occupying >= window.capacity) {
      throw conflict(
        `No capacity remains at this time (${occupying}/${window.capacity} booked).`,
      );
    }

    const endsAt = new Date(input.startsAt.getTime() + window.slotDurationMinutes * 60_000);
    const created = await ctx.db.appointment.create({
      data: {
        id: newId(),
        organizationId,
        branchId: input.branchId,
        departmentId: input.departmentId,
        patientId: input.patientId,
        providerId: input.providerId,
        startsAt: input.startsAt,
        endsAt,
        mode: input.mode,
        appointmentType: input.appointmentType ?? null,
        reason: input.reason ?? null,
        status: 'BOOKED',
        version: 1,
        createdById: this.tenantContext.requireUserId(),
        rescheduledFromId: input.rescheduledFromId ?? null,
      },
    });

    await this.appendTimeline(ctx, input.patientId, {
      type: 'appointment.booked',
      title: `Appointment booked`,
      requiredPermission: 'appointments.read',
      payload: { appointmentId: created.id, startsAt: input.startsAt.toISOString() },
    });
    await ctx.db.auditLog.create({
      data: {
        id: newId(),
        organizationId,
        action: 'appointments.booked',
        resource: 'appointment',
        resourceId: created.id,
        newState: {
          patientId: input.patientId,
          providerId: input.providerId,
          startsAt: input.startsAt,
        },
      },
    });
    ctx.emit({
      type: EventTypes.AppointmentBooked,
      aggregateType: 'appointment',
      aggregateId: created.id,
      payload: { appointmentId: created.id, patientId: input.patientId },
    });
    return created;
  }

  // ---------------------------------------------------------------------------
  // lifecycle transitions
  // ---------------------------------------------------------------------------

  async transition(id: string, input: UpdateAppointmentStatusDto) {
    const organizationId = this.tenantContext.requireOrg();

    const appointment = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireAppointment(ctx.db, organizationId, id);
      assertAppointmentTransition(current.status, input.status);

      const now = new Date();
      const data: Prisma.AppointmentUpdateInput = { status: input.status };
      if (input.status === 'CANCELLED') {
        data.cancelledAt = now;
        data.cancelReason = input.reason ?? null;
        data.cancelledById = this.tenantContext.scope.userId ?? null;
      } else if (input.status === 'NO_SHOW') {
        data.noShowAt = now;
      } else if (input.status === 'CHECKED_IN') {
        data.checkedInAt = now;
      } else if (input.status === 'IN_PROGRESS') {
        data.inProgressAt = now;
      } else if (input.status === 'COMPLETED') {
        data.completedAt = now;
      }

      const updated = await ctx.db.appointment.update({ where: { id }, data });

      await this.appendTimeline(ctx, updated.patientId, {
        type: `appointment.${input.status.toLowerCase()}`,
        title: `Appointment ${input.status.toLowerCase().replace('_', ' ')}`,
        requiredPermission: 'appointments.read',
        payload: { appointmentId: id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'appointments.transition',
          resource: 'appointment',
          resourceId: id,
          newState: { from: current.status, to: input.status, reason: input.reason ?? null },
        },
      });
      ctx.emit({
        type: eventForStatus(input.status),
        aggregateType: 'appointment',
        aggregateId: id,
        payload: { appointmentId: id, patientId: updated.patientId },
      });
      return updated;
    });

    this.publish(organizationId, 'appointments', {
      event: eventForStatus(input.status),
      aggregateId: id,
      payload: { appointmentId: id, status: input.status },
    });

    if (input.status === 'CANCELLED') {
      await this.offerWaitlistFor(appointment, input.reason);
    }

    return { appointment: serializeAppointment(appointment) };
  }

  async cancel(id: string, input: CancelAppointmentDto) {
    return this.transition(id, { status: 'CANCELLED', version: input.version, reason: input.reason });
  }

  async reschedule(id: string, input: RescheduleAppointmentDto) {
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireAppointment(ctx.db, organizationId, id);
      if (TERMINAL_APPOINTMENT_STATUSES.has(current.status)) {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: `A ${current.status} appointment cannot be rescheduled.`,
          silent: true,
        });
      }

      const replacement = await this.createBooking(ctx, organizationId, {
        patientId: current.patientId,
        providerId: current.providerId,
        branchId: current.branchId,
        departmentId: current.departmentId,
        startsAt: input.startsAt,
        mode: current.mode,
        appointmentType: current.appointmentType ?? undefined,
        reason: current.reason ?? undefined,
        rescheduledFromId: current.id,
      });

      const now = new Date();
      const superseded = await ctx.db.appointment.update({
        where: { id },
        data: {
          status: 'RESCHEDULED',
          rescheduledToId: replacement.id,
          rescheduledAt: now,
          version: { increment: 1 },
        },
      });

      await this.appendTimeline(ctx, current.patientId, {
        type: 'appointment.rescheduled',
        title: 'Appointment rescheduled',
        requiredPermission: 'appointments.read',
        payload: { fromAppointmentId: current.id, toAppointmentId: replacement.id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'appointments.rescheduled',
          resource: 'appointment',
          resourceId: replacement.id,
          newState: { fromAppointmentId: current.id, toAppointmentId: replacement.id, reason: input.reason ?? null },
        },
      });

      ctx.emit({
        type: EventTypes.AppointmentRescheduled,
        aggregateType: 'appointment',
        aggregateId: current.id,
        payload: { fromAppointmentId: current.id, toAppointmentId: replacement.id },
      });
      return { superseded, replacement };
    });

    this.publish(organizationId, 'appointments', {
      event: EventTypes.AppointmentRescheduled,
      aggregateId: id,
      payload: { fromAppointmentId: id, toAppointmentId: result.replacement.id },
    });

    return {
      appointment: serializeAppointment(result.replacement),
      superseded: serializeAppointment(result.superseded),
    };
  }

  // ---------------------------------------------------------------------------
  // waitlist
  // ---------------------------------------------------------------------------

  async joinWaitlist(input: JoinWaitlistDto) {
    const organizationId = this.tenantContext.requireOrg();

    const entry = await this.txRunner.run(async (ctx: TxContext) => {
      await this.assertPatient(ctx.db, organizationId, input.patientId);
      await Promise.all([
        this.assertDepartment(ctx.db, organizationId, input.branchId, input.departmentId),
        input.providerId
          ? ctx.db.user.findFirst({
              where: { id: input.providerId, organizationId },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

      const existing = await ctx.db.waitlistEntry.findFirst({
        where: {
          organizationId,
          patientId: input.patientId,
          departmentId: input.departmentId,
          status: { in: ['WAITING', 'OFFERED'] },
        },
        select: { id: true },
      });
      if (existing) {
        throw new AppError({
          code: ErrorCodes.WAITLIST_DUPLICATE,
          message: 'This patient already has an open waitlist entry for the department.',
          silent: true,
        });
      }

      const settings = await this.orgSettings(ctx.db, organizationId);
      if (settings.waitlist.maxPerDepartment > 0) {
        const open = await ctx.db.waitlistEntry.count({
          where: {
            organizationId,
            departmentId: input.departmentId,
            status: { in: ['WAITING', 'OFFERED'] },
          },
        });
        if (open >= settings.waitlist.maxPerDepartment) {
          throw new AppError({
            code: ErrorCodes.WAITLIST_FULL,
            message: 'This department’s waitlist is full.',
            silent: true,
          });
        }
      }

      const created = await ctx.db.waitlistEntry.create({
        data: {
          id: newId(),
          organizationId,
          branchId: input.branchId,
          departmentId: input.departmentId,
          patientId: input.patientId,
          providerId: input.providerId ?? null,
          preferredDate: input.preferredDate ?? null,
          notes: input.notes ?? null,
          status: 'WAITING',
        },
      });

      await this.appendTimeline(ctx, input.patientId, {
        type: 'waitlist.joined',
        title: 'Added to the waitlist',
        requiredPermission: 'waitlist.read',
        payload: { waitlistEntryId: created.id },
      });
      ctx.emit({
        type: EventTypes.WaitlistJoined,
        aggregateType: 'waitlist_entry',
        aggregateId: created.id,
        payload: { waitlistEntryId: created.id, patientId: input.patientId },
      });
      return created;
    });

    return { entry: serializeWaitlist(entry) };
  }

  async listWaitlist(query: { departmentId?: string; status?: string; page?: number; limit?: number }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.WaitlistEntryWhereInput = {};
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.status = query.status as WaitlistEntry['status'];

    const [rows, total] = await Promise.all([
      db.waitlistEntry.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.waitlistEntry.count({ where }),
    ]);
    return pageOf(rows.map(serializeWaitlist), total, page, limit);
  }

  async acceptWaitlistOffer(id: string, _input: AcceptWaitlistOfferDto) {
    const organizationId = this.tenantContext.requireOrg();

    const appointment = await this.txRunner.run(async (ctx: TxContext) => {
      const entry = await ctx.db.waitlistEntry.findFirst({ where: { id } });
      if (!entry) throw notFound('Waitlist entry not found');
      if (entry.status !== 'OFFERED') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'Only an OFFERED entry can be accepted.',
          silent: true,
        });
      }
      if (!entry.offeredStartAt) {
        throw new AppError({ code: ErrorCodes.OFFER_EXPIRED, message: 'Offer has no attached slot.', silent: true });
      }
      if (entry.offerExpiresAt && entry.offerExpiresAt.getTime() < Date.now()) {
        const expired = await ctx.db.waitlistEntry.update({
          where: { id },
          data: { status: 'EXPIRED', resolvedAt: new Date() },
        });
        ctx.emit({
          type: EventTypes.WaitlistOfferDeclined,
          aggregateType: 'waitlist_entry',
          aggregateId: id,
          payload: { waitlistEntryId: id },
        });
        throw new AppError({
          code: ErrorCodes.OFFER_EXPIRED,
          message: 'The offer has expired.',
          silent: true,
          details: { entryId: expired.id },
        });
      }

      const provider =
        entry.providerId ?? (await this.providerForDepartment(ctx.db, organizationId, entry.departmentId));
      if (!provider) {
        throw new AppError({
          code: ErrorCodes.RESOURCE_NOT_FOUND,
          message: 'No provider is available for this department.',
          silent: true,
        });
      }

      const created = await this.createBooking(ctx, organizationId, {
        patientId: entry.patientId,
        providerId: provider,
        branchId: entry.branchId,
        departmentId: entry.departmentId,
        startsAt: entry.offeredStartAt,
        mode: 'IN_PERSON',
      });

      await ctx.db.waitlistEntry.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          acceptedAppointmentId: created.id,
          resolvedAt: new Date(),
        },
      });
      await this.appendTimeline(ctx, entry.patientId, {
        type: 'waitlist.accepted',
        title: 'Waitlist offer accepted',
        requiredPermission: 'waitlist.read',
        payload: { waitlistEntryId: id, appointmentId: created.id },
      });
      ctx.emit({
        type: EventTypes.WaitlistOfferAccepted,
        aggregateType: 'waitlist_entry',
        aggregateId: id,
        payload: { waitlistEntryId: id, appointmentId: created.id, patientId: entry.patientId },
      });
      return created;
    });

    this.publish(organizationId, 'appointments', {
      event: EventTypes.WaitlistOfferAccepted,
      aggregateId: id,
      payload: { waitlistEntryId: id, appointmentId: appointment.id },
    });
    return { appointment: serializeAppointment(appointment) };
  }

  async declineWaitlistOffer(id: string, reason?: string) {
    const _organizationId = this.tenantContext.requireOrg();

    const entry = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.waitlistEntry.findFirst({ where: { id } });
      if (!current) throw notFound('Waitlist entry not found');
      if (current.status !== 'OFFERED') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'Only an OFFERED entry can be declined.',
          silent: true,
        });
      }
      await ctx.db.waitlistEntry.update({
        where: { id },
        data: { status: 'DECLINED', resolvedAt: new Date(), notes: reason ?? null },
      });
      await this.appendTimeline(ctx, current.patientId, {
        type: 'waitlist.declined',
        title: 'Waitlist offer declined',
        requiredPermission: 'waitlist.read',
        payload: { waitlistEntryId: id },
      });
      ctx.emit({
        type: EventTypes.WaitlistOfferDeclined,
        aggregateType: 'waitlist_entry',
        aggregateId: id,
        payload: { waitlistEntryId: id, patientId: current.patientId },
      });
      return current;
    });

    if (entry.offeredStartAt && entry.providerId && entry.branchId) {
      await this.offerNextWaitlist({
        branchId: entry.branchId,
        departmentId: entry.departmentId,
        startsAt: entry.offeredStartAt,
        providerId: entry.providerId,
      });
    }
    return { declined: true };
  }

  async leaveWaitlist(id: string) {
    const _organizationId = this.tenantContext.requireOrg();

    const entry = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.waitlistEntry.findFirst({ where: { id } });
      if (!current) throw notFound('Waitlist entry not found');
      if (current.status !== 'WAITING' && current.status !== 'OFFERED') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'Only WAITING or OFFERED entries can be removed.',
          silent: true,
        });
      }
      await ctx.db.waitlistEntry.update({
        where: { id },
        data: { status: 'REMOVED', resolvedAt: new Date() },
      });
      return current;
    });

    return { entry: serializeWaitlist(entry) };
  }

  /**
   * After a cancellation, offer the freed slot to the oldest WAITING entrant of
   * the same department (auto-book when the org setting says so).
   */
  private async offerWaitlistFor(cancelled: Appointment, _reason?: string): Promise<void> {
    await this.offerNextWaitlist({
      branchId: cancelled.branchId,
      departmentId: cancelled.departmentId,
      startsAt: cancelled.startsAt,
      providerId: cancelled.providerId,
    });
  }

  private async offerNextWaitlist(slot: FreedSlot): Promise<void> {
    const organizationId = this.tenantContext.requireOrg();

    const updated = await this.txRunner.run(async (ctx: TxContext) => {
      const settings = await this.orgSettings(ctx.db, organizationId);
      const next = await ctx.db.waitlistEntry.findFirst({
        where: {
          organizationId,
          departmentId: slot.departmentId,
          branchId: slot.branchId,
          status: 'WAITING',
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) return null;

      const providerId =
        next.providerId ??
        slot.providerId ??
        (await this.providerForDepartment(ctx.db, organizationId, slot.departmentId));
      if (!providerId) return null;

      if (settings.waitlist.autoBook) {
        let created;
        try {
          created = await this.createBooking(ctx, organizationId, {
            patientId: next.patientId,
            providerId,
            branchId: slot.branchId,
            departmentId: slot.departmentId,
            startsAt: slot.startsAt,
            mode: 'IN_PERSON',
          });
        } catch {
          return null;
        }
        await ctx.db.waitlistEntry.update({
          where: { id: next.id },
          data: { status: 'ACCEPTED', acceptedAppointmentId: created.id, resolvedAt: new Date() },
        });
        ctx.emit({
          type: EventTypes.WaitlistOfferAccepted,
          aggregateType: 'waitlist_entry',
          aggregateId: next.id,
          payload: { waitlistEntryId: next.id, appointmentId: created.id, patientId: next.patientId },
        });
        return { entry: next.id, appointmentId: created.id };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + settings.waitlist.offerExpiryMinutes * 60_000);
      await ctx.db.waitlistEntry.update({
        where: { id: next.id },
        data: {
          status: 'OFFERED',
          offeredAt: now,
          offerExpiresAt: expiresAt,
          offeredStartAt: slot.startsAt,
          providerId,
        },
      });
      ctx.emit({
        type: EventTypes.WaitlistOfferCreated,
        aggregateType: 'waitlist_entry',
        aggregateId: next.id,
        payload: { waitlistEntryId: next.id, startsAt: slot.startsAt },
      });
      return { entry: next.id };
    });

    if (updated) {
      this.publish(organizationId, 'appointments', {
        event: updated.appointmentId ? EventTypes.WaitlistOfferAccepted : EventTypes.WaitlistOfferCreated,
        aggregateId: updated.entry,
        payload: { waitlistEntryId: updated.entry },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // queries
  // ---------------------------------------------------------------------------

  async list(query: {
    patientId?: string;
    providerId?: string;
    branchId?: string;
    departmentId?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
  }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.AppointmentWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.providerId) where.providerId = query.providerId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.status = query.status as Appointment['status'];
    if (query.dateFrom || query.dateTo) {
      where.startsAt = {
        ...(query.dateFrom ? { gte: query.dateFrom } : {}),
        ...(query.dateTo ? { lte: query.dateTo } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      db.appointment.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.appointment.count({ where }),
    ]);
    return pageOf(rows.map(serializeAppointment), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const appointment = await this.requireAppointment(db, organizationId, id);
    return { appointment: serializeAppointment(appointment) };
  }

  // ---------------------------------------------------------------------------
  // shared helpers
  // ---------------------------------------------------------------------------

  private async requireAppointment(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    id: string,
  ) {
    const appointment = await db.appointment.findFirst({ where: { id, organizationId } });
    if (!appointment) throw notFound('Appointment not found');
    return appointment;
  }

  private async assertPatientAndProvider(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    patientId: string,
    providerId: string,
  ) {
    await this.assertPatient(db, organizationId, patientId);
    const provider = await db.user.findFirst({
      where: { id: providerId, organizationId },
      select: { id: true },
    });
    if (!provider) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Provider not found in this organization.',
        silent: true,
      });
    }
  }

  private async assertPatient(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    patientId: string,
  ) {
    const patient = await db.patient.findFirst({
      where: { id: patientId, organizationId },
      select: { id: true },
    });
    if (!patient) {
      throw new AppError({ code: ErrorCodes.PATIENT_NOT_FOUND, message: 'Patient not found', silent: true });
    }
  }

  private async assertDepartment(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    branchId: string,
    departmentId: string,
  ) {
    const [branch, department] = await Promise.all([
      db.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } }),
      db.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } }),
    ]);
    if (!branch || !department) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Branch or department not found.',
        silent: true,
      });
    }
  }

  private async providerForDepartment(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    departmentId: string,
  ): Promise<string | null> {
    const row = await db.userDepartment.findFirst({
      where: {
        organizationId,
        departmentId,
        user: {
          userRoles: { some: { role: { key: { in: ['DOCTOR', 'CLINICAL_OFFICER'] } } } },
        },
      },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    return row?.userId ?? null;
  }

  private async orgSettings(
    db: TenantClient | TxContext['db'],
    organizationId: string,
  ) {
    const row = await db.organizationSetting.findUnique({
      where: { organizationId },
      select: { data: true },
    });
    return parseOrgSettings(row?.data ?? null);
  }

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

  private publish(
    organizationId: string,
    topic: string,
    event: { event: string; aggregateId: string; payload: Record<string, unknown> },
  ): void {
    this.realtime.publish(organizationId, topic, { version: 1, ...event });
  }
}

// --- helpers ---

type FreedSlot = {
  branchId: string;
  departmentId: string;
  startsAt: Date;
  providerId: string | null;
};

function eventForStatus(status: Appointment['status']): string {
  switch (status) {
    case 'CONFIRMED':
      return EventTypes.AppointmentConfirmed;
    case 'CHECKED_IN':
      return EventTypes.AppointmentCheckedIn;
    case 'IN_PROGRESS':
      return EventTypes.AppointmentStarted;
    case 'COMPLETED':
      return EventTypes.AppointmentCompleted;
    case 'CANCELLED':
      return EventTypes.AppointmentCancelled;
    case 'NO_SHOW':
      return EventTypes.AppointmentNoShow;
    default:
      return EventTypes.AppointmentBooked;
  }
}

function conflict(message: string): AppError {
  return new AppError({ code: ErrorCodes.APPOINTMENT_CONFLICT, message, silent: true });
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function serializeAppointment(a: Appointment) {
  return {
    id: a.id,
    organizationId: a.organizationId,
    branchId: a.branchId,
    departmentId: a.departmentId,
    patientId: a.patientId,
    providerId: a.providerId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    mode: a.mode,
    appointmentType: a.appointmentType,
    reason: a.reason,
    status: a.status,
    version: a.version,
    checkedInAt: a.checkedInAt,
    inProgressAt: a.inProgressAt,
    completedAt: a.completedAt,
    noShowAt: a.noShowAt,
    cancelledAt: a.cancelledAt,
    cancelReason: a.cancelReason,
    rescheduledFromId: a.rescheduledFromId,
    rescheduledToId: a.rescheduledToId,
    rescheduledAt: a.rescheduledAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function serializeWaitlist(e: WaitlistEntry) {
  return {
    id: e.id,
    branchId: e.branchId,
    departmentId: e.departmentId,
    patientId: e.patientId,
    providerId: e.providerId,
    status: e.status,
    offeredAt: e.offeredAt,
    offerExpiresAt: e.offerExpiresAt,
    offeredStartAt: e.offeredStartAt,
    acceptedAppointmentId: e.acceptedAppointmentId,
    resolvedAt: e.resolvedAt,
    preferredDate: e.preferredDate,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}