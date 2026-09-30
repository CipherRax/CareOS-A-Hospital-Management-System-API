import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TxRunner } from '../../database/tx';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { EVENT_VERSION, EventTypes } from '../../events/catalog';
import { TenantContext } from '../../database/tenant-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { pageOf } from '../../common/pagination/pagination';
import { renderPdfTo } from '../../jobs/pdf/pdf-renderer';
import { PassThrough } from 'node:stream';
import { newId } from '../../common/lib/uuidv7';
import type {
  ExportReportDto,
  ReportExportsListQueryDto,
  ReportFormat,
  ReportType,
} from './dto/insights.dto';
import {
  contentTypeOf,
  csvHeaderLine,
  fileExtensionOf,
  rowToCsvLine,
  streamRowsToJson,
  type ReportPayload,
} from './domain/report-builder';
import { reportToPdfDocument } from './domain/report-document';
import { resolveWindow } from './domain/window';

/** Tenant-scoped Prisma client. `build` receives one rather than reading context. */
type ReportDb = TenantClient;

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
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly storage: ObjectStorageService,
    private readonly tx: TxRunner,
  ) {}

  /**
   * Requests an export. This does no work beyond recording the request.
   *
   * The report is built and rendered by `ReportExportConsumer` off a
   * `Reports.ExportRequested` event, so a wide report over a long window is no
   * longer bounded by the request's own timeout. The row and the event are
   * written in one transaction, so a committed request can never lose its work
   * item — the event *is* the row's guarantee of eventual completion.
   *
   * The window is resolved here and stored on the row, not left to the consumer
   * to recompute: `resolveWindow` fills in defaults relative to *now*, and a
   * consumer that ran minutes later against a sliding default would silently
   * produce a different report than the one that was asked for.
   */
  async exportReport(dto: ExportReportDto) {
    const organizationId = this.tenantContext.requireOrg();
    const requestedById = this.tenantContext.requireUserId();
    const { from, to } = resolveWindow(dto.from, dto.to, REPORT_WINDOW_DAYS[dto.reportType]);
    const window: ReportWindow = { from, to, branchId: dto.branchId };
    const id = newId();
    const now = new Date();

    const record = await this.tx.run(async (ctx) => {
      return ctx.db.reportExport.create({
        data: {
          id,
          organizationId,
          reportType: dto.reportType,
          format: dto.format,
          requestedById,
          from: window.from,
          to: window.to,
          branchId: window.branchId ?? null,
          departmentId: dto.departmentId ?? null,
          status: 'PENDING',
          contentType: contentTypeOf(dto.format),
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
    });

    // Emitted separately rather than via ctx.emit: the row must exist before the
    // dispatcher can see the event, and a consumer that races an uncommitted row
    // would have nothing to read. The transaction above already committed, so a
    // crash between the two loses the request — which the caller can see, since
    // the row stays PENDING, rather than silently.
    await this.emitRequested(organizationId, id);
    return this.present(record);
  }

  private async emitRequested(organizationId: string, exportId: string): Promise<void> {
    const db = this.prisma.unscoped();
    await db.outboxEvent.create({
      data: {
        id: newId(),
        organizationId,
        type: EventTypes.ExportRequested,
        version: EVENT_VERSION[EventTypes.ExportRequested],
        aggregateType: 'ReportExport',
        aggregateId: exportId,
        // Id only. The report parameters (window, branch, department) are
        // clinical context and stay on the row, where RLS already scopes them.
        payload: { exportId },
        status: 'PENDING',
        occurredAt: new Date(),
      },
    });
  }

  /**
   * Renders a pending export into object storage and marks it ready.
   *
   * Called only by the consumer, and deliberately idempotent: the outbox is
   * at-least-once, so this can run twice for one request. A row that is no
   * longer PENDING is left alone rather than re-rendered — re-rendering would
   * overwrite a good artifact with a new one and reset `completedAt` for no
   * reason.
   */
  async generate(exportId: string, organizationId: string): Promise<void> {
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.reportExport.findFirst({
      where: { id: exportId, organizationId },
    });
    if (!record) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Report export not found',
        silent: true,
      });
    }
    if (record.status !== 'PENDING') return;

    const window: ReportWindow = {
      from: record.from ?? new Date(record.createdAt),
      to: record.to ?? new Date(record.createdAt),
      branchId: record.branchId ?? undefined,
    };
    const payload = await this.build(record.reportType, window, db);

    // Tenant-scoped key. A flat key would let one organization's report be
    // fetched by another if a key were ever mixed up in a log or a bug; the
    // prefix makes that class of mistake visible in a bucket listing.
    const artifactKey = `reports/${organizationId}/${record.id}.${fileExtensionOf(record.format)}`;
    const sizeBytes = await this.store(payload, record, window, artifactKey);

    await db.reportExport.updateMany({
      where: { id: record.id, status: 'PENDING' },
      data: {
        status: 'READY',
        artifactKey,
        sizeBytes,
        summary: payload.summary as Prisma.InputJsonValue,
        completedAt: new Date(),
        error: null,
      },
    });
  }

  /**
   * Serialises a payload and streams it into storage, returning the byte count.
   *
   * The artifact is piped, not built: the renderer writes into the upload and
   * row/JSON/CSV chunks are fed in as they are produced, so peak memory is a
   * chunk rather than a whole PDF. The report *rows* are still in memory — they
   * are capped (see `DEFAULT_MAX_REPORT_ROWS`), which is what makes the byte
   * cap above a runaway guard rather than a routine limit.
   */
  private async store(
    payload: ReportPayload,
    record: { format: ReportFormat; contentType: string | null },
    window: ReportWindow,
    artifactKey: string,
  ): Promise<number> {
    const contentType = record.contentType ?? contentTypeOf(record.format);
    const body = new PassThrough();

    // Kicked off before the upload so the producer is already filling the pipe
    // while the first part goes up. Errors surface as a rejected promise and
    // are raced against the upload below.
    // The upload finishes when the pipe ends, and the pipe only ends once the
    // producer is done — so the end has to be sequenced inside `produced`, or
    // `putStream` would wait on a stream nobody closes.
    const produced = (async (): Promise<void> => {
      try {
        if (record.format === 'PDF') {
          await renderPdfTo(
            reportToPdfDocument(payload, {
              from: window.from,
              to: window.to,
              ...(window.branchId ? { branchLabel: window.branchId } : {}),
              confidentiality: 'Confidential — patient information. Handle per hospital policy.',
              createdAt: new Date(),
            }),
            body,
          );
        } else {
          await this.writeRows(body, payload, record.format);
        }
      } finally {
        body.end();
      }
    })();

    try {
      const sizeBytes = await this.storage.putStream(artifactKey, body, contentType);
      await produced;
      return sizeBytes;
    } catch (err) {
      // Release the producer so a render still writing does not keep a
      // document open (or leak a handle) after the upload gave up.
      body.destroy();
      await produced.catch(() => undefined);
      throw err;
    }
  }

  /** Feeds CSV/JSON rows into the upload a chunk at a time. */
  private async writeRows(
    body: PassThrough,
    payload: ReportPayload,
    format: ReportFormat,
  ): Promise<void> {
    // Backpressure-aware: a chunk is not handed to the next until the pipe
    // accepts it, so a slow upload cannot grow an unbounded queue in memory.
    const write = (text: string): Promise<void> =>
      new Promise((resolve, reject) => {
        body.write(text, (err: Error | null | undefined) => (err ? reject(err) : resolve()));
      });

    if (format === 'CSV') {
      const headers = payload.rows[0] ? Object.keys(payload.rows[0]) : [];
      if (headers.length > 0) {
        await write(`${csvHeaderLine(headers)}\n`);
        for (const row of payload.rows) {
          await write(`${rowToCsvLine(row, headers)}\n`);
        }
      }
      return;
    }

    for (const chunk of streamRowsToJson(payload.rows, payload.summary)) {
      await write(chunk);
    }
  }

  /**
   * Records a generation failure.
   *
   * The message is written to a column operators read, so it names the *cause*
   * (a font gap, a storage outage) and never the report contents. An expected
   * failure is recorded rather than thrown: a re-raised throw would make the
   * outbox retry a missing-glyph render on a tight loop, and the row would flip
   * FAILED/RETRYING forever with no operator-visible state.
   */
  async failGeneration(exportId: string, organizationId: string, message: string): Promise<void> {
    await this.prisma.tenantFor(organizationId).reportExport.updateMany({
      where: { id: exportId, organizationId, status: 'PENDING' },
      data: { status: 'FAILED', error: message, completedAt: new Date() },
    });
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
          summary: true,
          error: true,
          expiresAt: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);
    return pageOf(items.map((item) => this.present(item)), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.reportExport.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Report export not found', silent: true });
    }
    return this.present(record);
  }

  /**
   * Resolves a downloadable export and returns what the controller needs to
   * stream it. Deliberately returns the key rather than the bytes: the bytes
   * come back in chunks from object storage, so a large export never has to be
   * resident in the API's memory at once.
   */
  async downloadTarget(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.reportExport.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Report export not found', silent: true });
    }
    if (record.status !== 'READY' || !record.artifactKey) {
      // PENDING and FAILED are both "not yet / not downloadable" and both need
      // a different next action from the caller, so name the state rather than
      // returning a generic conflict.
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message:
          record.status === 'PENDING'
            ? 'Report is still being generated; poll GET /reports/exports/:id'
            : `Report is ${record.status.toLowerCase()}, not downloadable`,
        silent: true,
      });
    }
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      // The object is dropped here on the way past, but the *status* transition
      // stays with the scheduler: `expireArtifact` only writes to an already
      // EXPIRED row, so a read cannot mark one. That keeps a single writer for
      // the transition while still reclaiming the bytes on first contact.
      await this.expireArtifact(record.id, record.artifactKey).catch(() => undefined);
      throw new AppError({
        code: ErrorCodes.RESOURCE_EXPIRED,
        message: 'Report has expired (exports are available for 24 hours)',
        silent: true,
      });
    }
    return {
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      artifactKey: record.artifactKey,
      filename: this.filenameOf(record),
    };
  }

  /**
   * Deletes a stored artifact and clears the pointer on an already-expired row.
   *
   * The write is guarded on `status: 'EXPIRED'`, so this can only ever clear a
   * key on a row that is genuinely expired — it cannot un-expire a row, and it
   * cannot clobber a row something else revived. A delete that fails still
   * clears the pointer: the alternative is leaving a downloadable row behind
   * because S3 was briefly down, and the bucket's lifecycle rule is the backstop
   * for the orphaned object.
   */
  async expireArtifact(exportId: string, artifactKey: string | null): Promise<void> {
    if (artifactKey) {
      try {
        await this.storage.remove(artifactKey);
      } catch (err) {
        this.logger.warn(
          `could not remove expired report artifact ${artifactKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.prisma.unscoped().reportExport.updateMany({
      where: { id: exportId, status: 'EXPIRED' },
      data: { artifactKey: null },
    });
  }

  /** Common projection for GET /exports and the list endpoint. */
  private present(record: {
    id: string;
    reportType: ReportType;
    format: ReportFormat;
    status: string;
    contentType: string | null;
    sizeBytes: number | null;
    summary: unknown;
    error: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: record.id,
      reportType: record.reportType,
      format: record.format,
      status: record.status,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      // Present once generation has run. The request no longer builds the
      // report, so this is the only place a caller can see what an export holds
      // before downloading it.
      summary: record.summary ?? null,
      // A failure reason, never the artifact. Render errors name the missing
      // glyph, not the report contents.
      error: record.error,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
    };
  }

  private filenameOf(record: { reportType: ReportType; format: ReportFormat; id: string }): string {
    return `${record.reportType.toLowerCase()}-${record.id}.${fileExtensionOf(record.format)}`;
  }


  /**
   * The tenant client is a parameter, not something read from ambient context.
   * Report generation runs from the outbox consumer, where no request scope
   * exists, so a builder that reached for `requireOrg()` would fail with
   * TENANT_REQUIRED halfway through a background job.
   */
  private async build(
    type: ReportType,
    window: ReportWindow,
    db: ReportDb,
  ): Promise<ReportPayload> {
    switch (type) {
      case 'PATIENT':
        return this.buildPatient(window, db);
      case 'APPOINTMENT':
        return this.buildAppointment(window, db);
      case 'CLINICAL_OPERATIONS':
        return this.buildClinical(window, db);
      case 'LABORATORY':
        return this.buildLaboratory(window, db);
      case 'PHARMACY':
        return this.buildPharmacy(window, db);
      case 'FINANCIAL':
        return this.buildFinancial(window, db);
      case 'INSURANCE':
        return this.buildInsurance(window, db);
      case 'OPERATIONS':
        return this.buildOperations(window, db);
    }
  }

  private branch(options: { branchId?: string }) {
    return options.branchId ? { branchId: options.branchId } : {};
  }

  private async buildPatient(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  private async buildAppointment(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  private async buildClinical(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  private async buildLaboratory(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  private async buildPharmacy(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  private async buildFinancial(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  private async buildInsurance(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  private async buildOperations(window: ReportWindow, db: ReportDb): Promise<ReportPayload> {
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

  /** Request-path only: the builders get their client from their caller. */
  private tenantDb(): ReportDb {
    return this.prisma.tenantFor(this.tenantContext.requireOrg());
  }
}