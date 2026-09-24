import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { pageOf, paginate } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { formatRadiologyNumber, nextRadiologySequence } from './domain/radiology-number';
import { assertRadiologyAction } from './domain/radiology-flow';
import {
  CancelRadiologyOrderDto,
  CreateRadiologyOrderDto,
  ListRadiologyOrdersQueryDto,
  SubmitReportDto,
} from './dto/radiology.dto';
import {
  IMAGING_PROVIDER,
  PACS_GATEWAY,
} from '../../integrations/imaging/imaging.module';
import type { ImagingProvider, PacsGateway } from '../../integrations/imaging/imaging.provider';

/** Shared deep include for radiology orders. */
const ORDER_INCLUDE = {
  report: true,
} as const;

type RadiologyOrderInclude = typeof ORDER_INCLUDE;
type DeepRadiologyOrder = Prisma.RadiologyOrderGetPayload<{
  include: RadiologyOrderInclude;
}>;

/**
 * Radiology (brief §6.8): ORDERE → SCHEDULED → PERFORMED → REPORTED →
 * VERIFIED → RELEASED (cancel while ORDERED/SCHEDULED only). The 1:1
 * ImagingReport is required before a report can be verified. Imaging hardware
 * calls go through the vendor seam (no-op by default).
 */
@Injectable()
export class RadiologyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
    @Inject(IMAGING_PROVIDER) private readonly imaging: ImagingProvider,
    @Inject(PACS_GATEWAY) private readonly pacs: PacsGateway,
  ) {}

  async createOrder(input: CreateRadiologyOrderDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const order = await this.txRunner.run(async (ctx: TxContext) => {
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

      const id = newId();
      const seq = await nextRadiologySequence(ctx.db, organizationId);
      await ctx.db.radiologyOrder.create({
        data: {
          id,
          organizationId,
          orderNumber: formatRadiologyNumber(seq),
          patientId: input.patientId,
          branchId: input.branchId,
          encounterId: input.encounterId ?? null,
          modality: input.modality,
          region: input.region ?? null,
          status: 'ORDERED',
          clinicalNotes: input.clinicalNotes ?? null,
          orderedById: actorId,
          requestedAt: input.requestedAt ?? null,
        },
      });

      ctx.emit({
        type: EventTypes.RadiologyOrderCreated,
        aggregateType: 'radiology_order',
        aggregateId: id,
        payload: { orderId: id, patientId: input.patientId },
      });
      return this.loadOrder(ctx, organizationId, id);
    });
    return { order: serializeRadiologyOrder(order) };
  }

  async listOrders(query: ListRadiologyOrdersQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.RadiologyOrderWhereInput = {
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.radiologyOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.radiologyOrder.count({ where }),
    ]);
    return pageOf(rows.map(serializeRadiologyOrder), total, page, limit);
  }

  async getOrder(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const order = await db.radiologyOrder.findFirst({
      where: { id, organizationId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw notFound('Radiology order not found');
    return { order: serializeRadiologyOrder(order) };
  }

  async scheduleOrder(id: string) {
    const order = await this.transition(id, 'schedule');
    return { order: serializeRadiologyOrder(order) };
  }

  async performOrder(id: string) {
    const order = await this.transition(id, 'perform', async (ctx, orderId) => {
      const actorId = this.tenantContext.requireUserId();
      await ctx.db.radiologyOrder.update({
        where: { id: orderId },
        data: { performedById: actorId, performedAt: new Date() },
      });
      const payload = await this.orderPayload(ctx, orderId);
      ctx.emit({
        type: EventTypes.RadiologyPerformed,
        aggregateType: 'radiology_order',
        aggregateId: orderId,
        payload: { orderId, patientId: payload.patientId, modality: payload.modality },
      });
      await this.imaging.capture({
        orderId,
        patientId: payload.patientId,
        modality: payload.modality,
        region: payload.region,
      });
    });
    return { order: serializeRadiologyOrder(order) };
  }

  async cancelOrder(id: string, input: CancelRadiologyOrderDto) {
    const order = await this.transition(id, 'cancel', async (ctx, orderId) => {
      const actorId = this.tenantContext.requireUserId();
      await ctx.db.radiologyOrder.update({
        where: { id: orderId },
        data: { cancelledById: actorId, cancelledAt: new Date(), cancelledReason: input.reason },
      });
    });
    return { order: serializeRadiologyOrder(order) };
  }

  async submitReport(id: string, input: SubmitReportDto) {
    const organizationId = this.tenantContext.requireOrg();

    const order = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.radiologyOrder.findFirst({ where: { id, organizationId } });
      if (!current) throw notFound('Radiology order not found');
      const target = assertRadiologyAction(current, 'report');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'radiology_order', current.status, target);

      const reportId = newId();
      await ctx.db.imagingReport.upsert({
        where: { orderId: id },
        create: {
          id: reportId,
          organizationId,
          orderId: id,
          findings: input.findings,
          summary: input.summary ?? null,
          impression: input.impression ?? null,
          enteredById: this.tenantContext.requireUserId(),
          enteredAt: new Date(),
        },
        update: {
          findings: input.findings,
          summary: input.summary ?? null,
          impression: input.impression ?? null,
          version: { increment: 1 },
        },
      });

      const guard = await ctx.db.radiologyOrder.updateMany({
        where: { id, organizationId, status: 'PERFORMED' },
        data: { status: 'REPORTED' },
      });
      if (guard.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'The order changed while the report was submitted.', silent: true });
      }

      ctx.emit({
        type: EventTypes.RadiologyReportSubmitted,
        aggregateType: 'radiology_order',
        aggregateId: id,
        payload: { orderId: id, patientId: current.patientId },
      });
      return this.loadOrder(ctx, organizationId, id);
    });
    return { order: serializeRadiologyOrder(order) };
  }

  async verifyOrder(id: string) {
    const order = await this.transition(id, 'verify', async (ctx, orderId) => {
      const actorId = this.tenantContext.requireUserId();
      await ctx.db.imagingReport.updateMany({
        where: { orderId, organizationId: ctx.organizationId, verifiedById: null },
        data: { verifiedById: actorId, verifiedAt: new Date() },
      });
    });
    return { order: serializeRadiologyOrder(order) };
  }

  async releaseOrder(id: string) {
    const order = await this.transition(id, 'release', async (ctx, orderId) => {
      const actorId = this.tenantContext.requireUserId();
      const report = await ctx.db.imagingReport.findFirst({
        where: { orderId, organizationId: ctx.organizationId },
        select: { id: true, verifiedAt: true },
      });
      if (!report?.verifiedAt) {
        throw new AppError({
          code: ErrorCodes.LAB_RESULT_NOT_VERIFIED,
          message: 'An imaging report cannot be released before it is verified.',
          silent: true,
        });
      }
      await ctx.db.radiologyOrder.update({
        where: { id: orderId },
        data: { releasedById: actorId, releasedAt: new Date() },
      });
      const payload = await this.orderPayload(ctx, orderId);
      ctx.emit({
        type: EventTypes.RadiologyReportReleased,
        aggregateType: 'radiology_order',
        aggregateId: orderId,
        payload: { orderId, patientId: payload.patientId },
      });
      await this.pacs.publish({ orderId, reportId: report.id, patientId: payload.patientId });
    });
    return { order: serializeRadiologyOrder(order) };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async transition(
    id: string,
    action: 'schedule' | 'perform' | 'verify' | 'release' | 'cancel',
    sideEffect?: (ctx: TxContext, orderId: string) => Promise<void>,
  ): Promise<DeepRadiologyOrder> {
    const organizationId = this.tenantContext.requireOrg();

    return this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.radiologyOrder.findFirst({ where: { id, organizationId } });
      if (!current) throw notFound('Radiology order not found');

      const target = assertRadiologyAction(current, action);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'radiology_order', current.status, target);

      const guard = await ctx.db.radiologyOrder.updateMany({
        where: { id, organizationId, status: current.status },
        data: { status: target },
      });
      if (guard.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'The order changed underneath this action.', silent: true });
      }
      await sideEffect?.(ctx, id);
      return this.loadOrder(ctx, organizationId, id);
    });
  }

  private async loadOrder(ctx: TxContext, organizationId: string, id: string): Promise<DeepRadiologyOrder> {
    const row = await ctx.db.radiologyOrder.findFirst({
      where: { id, organizationId },
      include: ORDER_INCLUDE,
    });
    if (!row) throw notFound('Radiology order not found');
    return row;
  }

  private async orderPayload(ctx: TxContext, orderId: string) {
    const row = await ctx.db.radiologyOrder.findFirst({
      where: { id: orderId, organizationId: ctx.organizationId },
      select: { patientId: true, modality: true, region: true },
    });
    if (!row) throw notFound('Radiology order not found');
    return row;
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serializeRadiologyOrder(p: DeepRadiologyOrder) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    orderNumber: p.orderNumber,
    patientId: p.patientId,
    branchId: p.branchId,
    encounterId: p.encounterId,
    modality: p.modality,
    region: p.region,
    status: p.status,
    clinicalNotes: p.clinicalNotes,
    orderedById: p.orderedById,
    orderedAt: p.orderedAt,
    requestedAt: p.requestedAt,
    performedById: p.performedById,
    performedAt: p.performedAt,
    cancelledById: p.cancelledById,
    cancelledAt: p.cancelledAt,
    cancelledReason: p.cancelledReason,
    releasedById: p.releasedById,
    releasedAt: p.releasedAt,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    report: p.report,
  };
}