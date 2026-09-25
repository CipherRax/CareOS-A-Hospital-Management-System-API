import { Injectable } from '@nestjs/common';
import type { Prisma, VirtualSession } from '@prisma/client';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { assertTransition, canStart } from './domain/virtual-session-flow';
import type {
  CancelVirtualSessionDto,
  ListVirtualSessionsQueryDto,
  ScheduleVirtualSessionDto,
} from './dto/virtual-session.dto';

type VirtualSessionDb = TenantClient | TxContext['db'];

@Injectable()
export class TelemedicineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async schedule(input: ScheduleVirtualSessionDto) {
    const organizationId = this.tenantContext.requireOrg();
    this.assertStaffPrincipal();
    if (input.scheduledEndAt && input.scheduledEndAt <= input.scheduledStartAt) {
      throw validation('scheduledEndAt must be after scheduledStartAt');
    }

    const session = await this.txRunner.run(async (ctx: TxContext) => {
      const branch = await ctx.db.branch.findFirst({
        where: { id: input.branchId, organizationId },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch not found');

      const patient = await ctx.db.patient.findFirst({
        where: { id: input.patientId, organizationId },
        select: { id: true },
      });
      if (!patient) throw notFound('Patient not found');

      const provider = await ctx.db.user.findFirst({
        where: { id: input.providerId, organizationId },
        select: { id: true },
      });
      if (!provider) throw notFound('Provider not found in this organization');

      if (input.appointmentId) {
        const appointment = await ctx.db.appointment.findFirst({
          where: { id: input.appointmentId, organizationId },
          select: { id: true },
        });
        if (!appointment) throw notFound('Appointment not found');
      }

      const consent = await ctx.db.patientConsent.findFirst({
        where: {
          organizationId,
          patientId: input.patientId,
          type: 'TELEMEDICINE',
          status: 'GRANTED',
        },
      });
      if (!consent) throw consentRequired();

      const id = newId();
      const created = await ctx.db.virtualSession.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId,
          appointmentId: input.appointmentId ?? null,
          patientId: input.patientId,
          providerId: input.providerId,
          status: 'SCHEDULED',
          consentRecorded: true,
          consentId: consent.id,
          meetingRef: `meet-${id}`,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt ?? null,
        },
      });
      ctx.emit({
        type: EventTypes.TelemedicineScheduled,
        aggregateType: 'virtual_session',
        aggregateId: id,
        payload: { sessionId: id, patientId: input.patientId },
      });
      return created;
    });

    return { session: serializeSession(session) };
  }

  async list(query: ListVirtualSessionsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    this.assertStaffPrincipal();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);
    const where: Prisma.VirtualSessionWhereInput = { organizationId };
    if (query.status) where.status = query.status;
    if (query.providerId) where.providerId = query.providerId;
    if (query.patientId) where.patientId = query.patientId;

    const [rows, total] = await Promise.all([
      db.virtualSession.findMany({
        where,
        orderBy: { scheduledStartAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.virtualSession.count({ where }),
    ]);
    return pageOf(rows.map(serializeSession), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    this.assertStaffPrincipal();
    const db = this.prisma.tenantFor(organizationId);
    const session = await this.requireSession(db, organizationId, id);
    return { session: serializeSession(session) };
  }

  async start(id: string, byUserId: string) {
    const organizationId = this.tenantContext.requireOrg();
    this.assertStaffPrincipal();

    const session = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireSession(ctx.db, organizationId, id);
      assertTransition(current.status, 'STARTED');
      if (byUserId !== current.providerId) {
        throw forbidden(
          'Only the assigned provider can start this telemedicine session.',
        );
      }
      if (
        !canStart({
          status: current.status,
          consentRecorded: current.consentRecorded,
          scheduledStartAt: current.scheduledStartAt,
          now: new Date(),
        })
      ) {
        throw consentRequired();
      }

      const updated = await ctx.db.virtualSession.update({
        where: { id },
        data: { status: 'STARTED', startedAt: new Date() },
      });
      ctx.emit({
        type: EventTypes.TelemedicineStarted,
        aggregateType: 'virtual_session',
        aggregateId: id,
        payload: { sessionId: id, patientId: current.patientId },
      });
      return updated;
    });

    return { session: serializeSession(session) };
  }

  async end(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    this.assertStaffPrincipal();

    const session = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireSession(ctx.db, organizationId, id);
      assertTransition(current.status, 'ENDED');
      const updated = await ctx.db.virtualSession.update({
        where: { id },
        data: { status: 'ENDED', endedAt: new Date() },
      });
      ctx.emit({
        type: EventTypes.TelemedicineEnded,
        aggregateType: 'virtual_session',
        aggregateId: id,
        payload: { sessionId: id, patientId: current.patientId },
      });
      return updated;
    });

    return { session: serializeSession(session) };
  }

  async cancel(id: string, input: CancelVirtualSessionDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorUserId = this.tenantContext.requireUserId();
    this.assertStaffPrincipal();
    if (!input.cancelReason.trim()) throw validation('cancelReason is required');

    const session = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireSession(ctx.db, organizationId, id);
      assertTransition(current.status, 'CANCELLED');
      const updated = await ctx.db.virtualSession.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledById: actorUserId,
          cancelledAt: new Date(),
          cancelReason: input.cancelReason,
        },
      });
      ctx.emit({
        type: EventTypes.TelemedicineCancelled,
        aggregateType: 'virtual_session',
        aggregateId: id,
        payload: { sessionId: id, patientId: current.patientId },
      });
      return updated;
    });

    return { session: serializeSession(session) };
  }

  private async requireSession(
    db: VirtualSessionDb,
    organizationId: string,
    id: string,
  ): Promise<VirtualSession> {
    const session = await db.virtualSession.findFirst({ where: { id, organizationId } });
    if (!session) throw notFound('Virtual session not found');
    return session;
  }

  private assertStaffPrincipal(): void {
    const scope = this.tenantContext.scope;
    if (scope.patientId != null || scope.roles.includes('PATIENT')) {
      throw new AppError({
        code: ErrorCodes.PATIENT_ACCESS_DENIED,
        message: 'Telemedicine sessions are available to staff only.',
        silent: true,
      });
    }
  }
}

function serializeSession(session: VirtualSession) {
  return {
    id: session.id,
    organizationId: session.organizationId,
    branchId: session.branchId,
    appointmentId: session.appointmentId,
    patientId: session.patientId,
    providerId: session.providerId,
    status: session.status,
    consentRecorded: session.consentRecorded,
    consentId: session.consentId,
    meetingRef: session.meetingRef,
    scheduledStartAt: session.scheduledStartAt,
    scheduledEndAt: session.scheduledEndAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    cancelledById: session.cancelledById,
    cancelledAt: session.cancelledAt,
    cancelReason: session.cancelReason,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function consentRequired(): AppError {
  return new AppError({
    code: ErrorCodes.TELEMEDICINE_CONSENT_REQUIRED,
    message: 'A granted telemedicine consent is required before scheduling a session.',
    silent: true,
  });
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function forbidden(message: string): AppError {
  return new AppError({ code: ErrorCodes.PERMISSION_DENIED, message, silent: true });
}

function validation(message: string): AppError {
  return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message, silent: true });
}
