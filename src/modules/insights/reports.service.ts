import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { pageOf } from '../../common/pagination/pagination';
import { renderTextPdf } from '../../jobs/pdf/pdf-renderer';
import { newId } from '../../common/lib/uuidv7';
import type {
  ExportReportDto,
  ReportExportsListQueryDto,
  ReportFormat,
  ReportType,
} from './dto/insights.dto';
import {
  contentTypeOf,
  fileExtensionOf,
  rowsToCsv,
  rowsToJson,
  rowsToPdfLines,
  type ReportPayload,
} from './domain/report-builder';
import { resolveWindow } from './domain/window';

interface ReportWindow {
  from: Date;
  to: Date;
  branchId?: string;
}

const REPORT_WINDOW_DAYS: Record<ReportType, number> = {
  PATIENT: 30,
  APPOINTMENT: 30,
  CLINICAL_OPERATIONS: 30,
  LABORATORY: 30,
  PHARMACY: 30,
  FINANCIAL: 30,
  INSURANCE: 30,
  OPERATIONS: 30,
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async exportReport(dto: ExportReportDto) {
    const organizationId = this.tenantContext.requireOrg();
    const requestedById = this.tenantContext.requireUserId();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(dto.from, dto.to, REPORT_WINDOW_DAYS[dto.reportType]);
    const window: ReportWindow = { from, to, branchId: dto.branchId };

    const payload = await this.build(dto.reportType, window);
    const artifactText = this.serialize(payload, dto.format);
    const now = new Date();
    const record = await db.reportExport.create({
      data: {
        id: newId(),
        organizationId,
        reportType: dto.reportType,
        format: dto.format,
        requestedById,
        from: window.from,
        to: window.to,
        branchId: window.branchId ?? null,
        departmentId: dto.departmentId ?? null,
        status: 'READY',
        contentType: contentTypeOf(dto.format),
        artifact: artifactText,
        sizeBytes: Buffer.byteLength(artifactText),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    return {
      id: record.id,
      reportType: record.reportType,
      format: record.format,
      status: record.status,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      summary: payload.summary,
    };
  }

  async list(query: ReportExportsListQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const page = query.page ?? 1;
    const limit = Math.min(query.pageSize ?? 25, 100);
    const where: Prisma.ReportExportWhereInput = {
      organizationId,
      ...(query.reportType ? { reportType: query.reportType } : {}),
    };
    const [total, items] = await Promise.all([
      db.reportExport.count({ where }),
      db.reportExport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          reportType: true,
          format: true,
          status: true,
          contentType: true,
          sizeBytes: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);
    return pageOf(items, total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.reportExport.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Report export not found', silent: true });
    }
    return {
      id: record.id,
      reportType: record.reportType,
      format: record.format,
      status: record.status,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async download(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.reportExport.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Report export not found', silent: true });
    }
    if (record.status !== 'READY') {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: `Report is ${record.status.toLowerCase()}, not downloadable`,
        silent: true,
      });
    }
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      await db.reportExport.update({ where: { id }, data: { status: 'EXPIRED' } }).catch(() => undefined);
      throw new AppError({
        code: ErrorCodes.RESOURCE_EXPIRED,
        message: 'Report has expired (exports are available for 24 hours)',
        silent: true,
      });
    }
    return {
      filename: `${record.reportType.toLowerCase()}-${record.id}.${fileExtensionOf(record.format)}`,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      artifact: record.artifact,
    };
  }

  private serialize(payload: ReportPayload, format: ReportFormat): string {
    switch (format) {
      case 'PDF':
        return renderTextPdf({
          title: payload.title,
          lines: rowsToPdfLines(payload),
          meta: payload.meta,
        }).toString('base64');
      case 'CSV':
        return rowsToCsv(payload.rows);
      default:
        return rowsToJson(payload.rows, payload.summary);
    }
  }

  private async build(type: ReportType, window: ReportWindow): Promise<ReportPayload> {
    switch (type) {
      case 'PATIENT':
        return this.buildPatient(window);
      case 'APPOINTMENT':
        return this.buildAppointment(window);
      case 'CLINICAL_OPERATIONS':
        return this.buildClinical(window);
      case 'LABORATORY':
        return this.buildLaboratory(window);
      case 'PHARMACY':
        return this.buildPharmacy(window);
      case 'FINANCIAL':
        return this.buildFinancial(window);
      case 'INSURANCE':
        return this.buildInsurance(window);
      case 'OPERATIONS':
        return this.buildOperations(window);
    }
  }

  private branch(options: { branchId?: string }) {
    return options.branchId ? { branchId: options.branchId } : {};
  }

  private async buildPatient(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const rows = await db.patient.findMany({
      where: { createdAt: { gte: window.from, lte: window.to } },
      select: { patientNumber: true, firstName: true, lastName: true, sex: true, county: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const sexes = rows.reduce<Record<string, number>>((a, r) => {
      a[r.sex ?? 'UNSPECIFIED'] = (a[r.sex ?? 'UNSPECIFIED'] ?? 0) + 1;
      return a;
    }, {});
    return {
      title: 'Patient register',
      meta: this.meta(window),
      rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      summary: { total: rows.length, sexes },
    };
  }

  private async buildAppointment(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const rows = await db.appointment.findMany({
      where: { startsAt: { gte: window.from, lte: window.to }, ...this.branch(window) },
      select: { id: true, startsAt: true, status: true, departmentId: true, providerId: true },
      orderBy: { startsAt: 'asc' },
    });
    const statuses = rows.reduce<Record<string, number>>((a, r) => {
      a[r.status] = (a[r.status] ?? 0) + 1;
      return a;
    }, {});
    return {
      title: 'Appointments',
      meta: this.meta(window),
      rows: rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() })),
      summary: {
        total: rows.length,
        statuses,
        noShowRate: rows.length ? Math.round(((statuses.NO_SHOW ?? 0) / rows.length) * 10000) / 100 : null,
      },
    };
  }

  private async buildClinical(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const [rows, notesFinalized, diagnoses, tasksCompleted, referrals, followUps] = await Promise.all([
      db.encounter.findMany({
        where: { openedAt: { gte: window.from, lte: window.to }, ...this.branch(window) },
        select: { id: true, type: true, status: true, openedAt: true, completedAt: true, providerId: true },
        orderBy: { openedAt: 'desc' },
      }),
      db.clinicalNote.count({ where: { finalizedAt: { gte: window.from, lte: window.to } } }),
      db.diagnosis.count({ where: { createdAt: { gte: window.from, lte: window.to } } }),
      db.task.count({ where: { status: 'DONE', completedAt: { gte: window.from, lte: window.to } } }),
      db.referral.count({ where: { createdAt: { gte: window.from, lte: window.to } } }),
      db.followUp.count({ where: { status: 'SCHEDULED', dueAt: { gte: window.from, lte: window.to } } }),
    ]);
    return {
      title: 'Clinical operations',
      meta: this.meta(window),
      rows: rows.map((r) => ({
        ...r,
        openedAt: r.openedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      summary: {
        encountersOpened: rows.length,
        encountersCompleted: rows.filter((r) => r.status === 'COMPLETED').length,
        notesFinalized,
        diagnosesRecorded: diagnoses,
        tasksCompleted,
        referrals,
        scheduledFollowUps: followUps,
      },
    };
  }

  private async buildLaboratory(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const [rows, rejectedSamples, criticalPending] = await Promise.all([
      db.labOrder.findMany({
        where: { createdAt: { gte: window.from, lte: window.to }, ...this.branch(window) },
        select: { orderNumber: true, status: true, createdAt: true, releasedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      db.labSample.count({ where: { rejectedAt: { gte: window.from, lte: window.to } } }),
      db.criticalResult.count({ where: { acknowledgedAt: null } }),
    ]);
    const tats = rows
      .filter((r) => r.releasedAt)
      .map((r) => (r.releasedAt!.getTime() - r.createdAt.getTime()) / 60000);
    return {
      title: 'Laboratory',
      meta: this.meta(window),
      rows: rows.map((r) => ({
        orderNumber: r.orderNumber,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        releasedAt: r.releasedAt?.toISOString() ?? null,
        tatMinutes: r.releasedAt ? Math.round(((r.releasedAt.getTime() - r.createdAt.getTime()) / 60000) * 100) / 100 : null,
      })),
      summary: {
        orders: rows.length,
        released: rows.filter((r) => r.releasedAt).length,
        avgTatMinutes: tats.length ? Math.round((tats.reduce((a, b) => a + b, 0) / tats.length) * 100) / 100 : null,
        rejectedSamples,
        criticalResultsPendingAcknowledgment: criticalPending,
      },
    };
  }

  private async buildPharmacy(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const [dispensed, received, stockTotals] = await Promise.all([
      db.prescription.findMany({
        where: { dispensedAt: { gte: window.from, lte: window.to }, ...this.branch(window) },
        select: { id: true, dispensedAt: true, items: { select: { quantity: true, dispensedQuantity: true } } },
        orderBy: { dispensedAt: 'desc' },
      }),
      db.stockBatch.findMany({
        where: { receivedAt: { gte: window.from, lte: window.to }, ...this.branch(window) },
        select: { batchNumber: true, medicationId: true, receivedAt: true, onHand: true },
      }),
      db.inventoryLedgerEntry.aggregate({
        where: { operation: 'WASTAGE', occurredAt: { gte: window.from, lte: window.to } },
        _sum: { quantity: true },
      }),
    ]);
    const rows = dispensed.map((p) => ({
      id: p.id,
      dispensedAt: p.dispensedAt?.toISOString() ?? null,
      units: (p.items ?? []).reduce((b, i) => b + Number(i.dispensedQuantity ?? i.quantity ?? 0), 0),
    }));
    return {
      title: 'Pharmacy',
      meta: this.meta(window),
      rows,
      summary: {
        prescriptionsDispensed: dispensed.length,
        unitsDispensed: rows.reduce((a, r) => a + r.units, 0),
        lotsReceived: received.length,
        unitsReceived: received.reduce((a, b) => a + b.onHand, 0),
        wastageUnits: Math.abs(Number(stockTotals._sum?.quantity ?? 0)),
      },
    };
  }

  private async buildFinancial(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const [invoices, payments, expenses] = await Promise.all([
      db.invoice.findMany({
        where: { issuedAt: { gte: window.from, lte: window.to }, ...this.branch(window) },
        select: { invoiceNumber: true, issuedAt: true, total: true, status: true, balanceDue: true },
        orderBy: { issuedAt: 'desc' },
      }),
      db.payment.findMany({
        where: { status: 'COMPLETED', recordedAt: { gte: window.from, lte: window.to } },
        select: { receiptNumber: true, amount: true, method: true },
      }),
      db.expense.findMany({
        where: { status: { in: ['APPROVED'] }, approvedAt: { gte: window.from, lte: window.to } },
        select: { expenseNumber: true, amount: true, approvedAt: true },
      }),
    ]);
    const revenue = payments.reduce((a, p) => a + Number(p.amount), 0);
    const outstanding = invoices
      .filter((i) => i.status !== 'PAID' && i.status !== 'CANCELLED')
      .reduce((a, i) => a + Number(i.balanceDue ?? i.total), 0);
    return {
      title: 'Financial',
      meta: this.meta(window),
      rows: invoices.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        issuedAt: i.issuedAt?.toISOString() ?? null,
        total: i.total.toFixed(2),
        balanceDue: Number(i.balanceDue ?? i.total).toFixed(2),
      })),
      summary: {
        revenueCollected: revenue.toFixed(2),
        invoicesIssued: invoices.length,
        invoicesTotal: invoices.reduce((a, i) => a + Number(i.total), 0).toFixed(2),
        outstanding: outstanding.toFixed(2),
        payments: payments.length,
        expensesApproved: expenses.reduce((a, e) => a + Number(e.amount), 0).toFixed(2),
      },
    };
  }

  private async buildInsurance(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const rows = await db.insuranceClaim.findMany({
      where: { submittedAt: { gte: window.from, lte: window.to } },
      select: { claimNumber: true, status: true, amount: true, approvedAmount: true, submittedAt: true, paidAt: true },
      orderBy: { submittedAt: 'desc' },
    });
    const now = Date.now();
    const bucket = (c: { submittedAt: Date | null; paidAt: Date | null }): string => {
      if (!c.submittedAt) return 'UNSUBMITTED';
      if (!c.paidAt) {
        const days = Math.floor((now - c.submittedAt.getTime()) / 86400000);
        return days > 90 ? '90+' : days > 60 ? 'D61-90' : days > 30 ? 'D31-60' : 'D0-30';
      }
      return 'PAID';
    };
    const buckets = rows.reduce<Record<string, number>>((a, c) => {
      a[bucket(c)] = (a[bucket(c)] ?? 0) + 1;
      return a;
    }, {});
    return {
      title: 'Insurance claims',
      meta: this.meta(window),
      rows: rows.map((c) => ({
        claimNumber: c.claimNumber,
        status: c.status,
        amount: c.amount.toFixed(2),
        approvedAmount: c.approvedAmount?.toFixed(2) ?? null,
        submittedAt: c.submittedAt?.toISOString() ?? null,
        paidAt: c.paidAt?.toISOString() ?? null,
        bucket: bucket(c),
      })),
      summary: {
        submitted: rows.length,
        paid: rows.filter((c) => c.paidAt).length,
        submittedAmount: rows.reduce((a, c) => a + Number(c.amount), 0).toFixed(2),
        paidAmount: rows
          .filter((c) => c.paidAt)
          .reduce((a, c) => a + Number(c.approvedAmount ?? 0), 0)
          .toFixed(2),
        agingBuckets: buckets,
      },
    };
  }

  private async buildOperations(window: ReportWindow): Promise<ReportPayload> {
    const db = this.tenantDb();
    const rows = await db.queueEntry.findMany({
      where: { enteredAt: { gte: window.from, lte: window.to }, ...this.branch(window) },
      select: {
        ticketNumber: true,
        status: true,
        enteredAt: true,
        serviceStartedAt: true,
        completedAt: true,
        departmentId: true,
      },
      orderBy: { enteredAt: 'asc' },
    });
    const served = rows.filter((r) => r.serviceStartedAt);
    const waitMinutes = (r: (typeof rows)[number]): number | null =>
      r.serviceStartedAt
        ? Math.round(((r.serviceStartedAt.getTime() - r.enteredAt.getTime()) / 60000) * 100) / 100
        : null;
    const waits = served.map((r) => waitMinutes(r) ?? 0);
    const departments = rows.reduce<Record<string, number>>((a, r) => {
      a[r.departmentId] = (a[r.departmentId] ?? 0) + 1;
      return a;
    }, {});
    return {
      title: 'Operations',
      meta: this.meta(window),
      rows: rows.map((r) => ({
        ticketNumber: r.ticketNumber,
        status: r.status,
        departmentId: r.departmentId,
        enteredAt: r.enteredAt.toISOString(),
        serviceStartedAt: r.serviceStartedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        waitMinutes: waitMinutes(r),
      })),
      summary: {
        tickets: rows.length,
        served: served.length,
        avgWaitMinutes: waits.length ? Math.round((waits.reduce((a, b) => a + b, 0) / waits.length) * 100) / 100 : null,
        byDepartment: departments,
      },
    };
  }

  private meta(window: ReportWindow): Record<string, string> {
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      branchId: window.branchId ?? 'all',
      generatedAt: new Date().toISOString(),
    };
  }

  private tenantDb() {
    const organizationId = this.tenantContext.requireOrg();
    return this.prisma.tenantFor(organizationId);
  }
}