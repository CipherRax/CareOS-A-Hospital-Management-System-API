import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { FeedbackService, type SubmitFeedbackInput } from '../quality/feedback.service';
import {
  scopeGuard,
  toPublicAppointment,
  toPublicLabResult,
  toPublicPatient,
} from './domain/portal';
import type { PortalLabResultsQueryDto } from './dto/portal.dto';

export interface PortalAppointmentsQuery {
  page?: number;
  limit?: number;
}

export interface SubmitPortalFeedbackInput {
  branchId?: string | null;
  category: SubmitFeedbackInput['category'];
  rating: number;
  comment?: string | null;
}

/**
 * Patient portal (brief Phase 10). Every read is confined to the caller's own
 * patient record (patientId = scope.patientId). Feedback submission delegates
 * to the quality FeedbackService with the patientId forced server-side.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly feedback: FeedbackService,
  ) {}

  async me() {
    const organizationId = this.tenantContext.requireOrg();
    const patientId = scopeGuard(this.tenantContext.scope.patientId);
    const db = this.prisma.tenantFor(organizationId);
    const patient = await db.patient.findFirst({
      where: { id: patientId, organizationId },
    });
    if (!patient) throw patientNotFound();
    return { patient: toPublicPatient(patient) };
  }

  async appointments(query: PortalAppointmentsQuery) {
    const organizationId = this.tenantContext.requireOrg();
    const patientId = scopeGuard(this.tenantContext.scope.patientId);
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.AppointmentWhereInput = {
      organizationId,
      patientId,
    };
    const [rows, total] = await Promise.all([
      db.appointment.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.appointment.count({ where }),
    ]);
    return pageOf(rows.map(toPublicAppointment), total, page, limit);
  }

  async labResults(query: PortalLabResultsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const patientId = scopeGuard(this.tenantContext.scope.patientId);
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.LabResultWhereInput = {
      organizationId,
      orderItem: {
        is: { order: { is: { patientId, status: 'RELEASED' } } },
      },
    };
    const [rows, total] = await Promise.all([
      db.labResult.findMany({
        where,
        include: {
          orderItem: {
            select: {
              id: true,
              testId: true,
              order: { select: { id: true, releasedAt: true } },
            },
          },
          testField: {
            select: {
              name: true,
              unit: true,
              referenceMin: true,
              referenceMax: true,
            },
          },
          versions: {
            orderBy: { revisionNumber: 'desc' },
            take: 1,
            select: { verifiedAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.labResult.count({ where }),
    ]);

    const items = rows.map((r) =>
      toPublicLabResult({
        id: r.id,
        orderId: r.orderItem.order.id,
        itemId: r.orderItem.id,
        testId: r.orderItem.testId,
        testName: r.testField.name,
        value: r.value,
        unit: r.testField.unit,
        referenceMin: r.testField.referenceMin,
        referenceMax: r.testField.referenceMax,
        isAbnormal: r.isAbnormal,
        isCritical: r.isCritical,
        verifiedAt: r.versions[0]?.verifiedAt ?? null,
        releasedAt: r.orderItem.order.releasedAt,
      }),
    );
    return pageOf(items, total, page, limit);
  }

  async submitFeedback(input: SubmitPortalFeedbackInput) {
    const patientId = scopeGuard(this.tenantContext.scope.patientId);
    return this.feedback.submit({ ...input, patientId });
  }
}

function patientNotFound(): AppError {
  return new AppError({
    code: ErrorCodes.RESOURCE_NOT_FOUND,
    message: 'Patient profile not found',
    silent: true,
  });
}