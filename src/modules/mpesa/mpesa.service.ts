import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { newId } from '../../common/lib/uuidv7';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/config.module';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { EventTypes } from '../../events/catalog';
import {
  MPESA_STK_PROVIDER,
  parseStkCallback,
  type MpesaStkProvider,
  type StkCallbackParsed,
} from '../../integrations/mpesa/mpesa-integration.module';
import { MockMpesaProvider as MockImpl } from '../../integrations/mpesa/mpesa.provider';
import { WorkflowsService } from '../workflows/workflows.service';
import { formatBillingNumber, nextBillingSequence } from '../billing/domain/billing-number';
import { settleInvoiceStatus } from '../billing/domain/billing-flow';
import { classifyPayment } from './domain/mpesa-flow';
import type {
  InitiateStkPushDto,
  ListReconciliationsQueryDto,
  ListRequestsQueryDto,
  ReconcileDto,
  ResolveMatchDto,
} from './dto/mpesa.dto';

/**
 * M-PESA STK push + reconciliation (repo Phase 11).
 * A payment row is ONLY materialized when the telco callback confirms the
 * charge at the requested amount (drives Billing.PaymentCompleted so the
 * ledger auto-posts Cash/AR). A callback that differs from the request amount
 * flags the request MISMATCHED and records no payment — reconciliation sees
 * the provider-side charge and the accountant resolves it as an audited stamp.
 *
 * Exactly-once: request status transitions are conditional UPDATEs
 * (PENDING→terminal); concurrent/duplicate callbacks lose the race and are
 * acknowledged without creating another payment.
 */
@Injectable()
export class MpesaService {
  private readonly logger = new Logger(MpesaService.name);

  constructor(
    private readonly txRunner: TxRunner,
    private readonly tenantContext: TenantContext,
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    @Inject(MPESA_STK_PROVIDER) private readonly provider: MpesaStkProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ─── STK push ──────────────────────────────────────────────────────────────

  async initiateStkPush(input: InitiateStkPushDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    return this.txRunner.run(async (ctx: TxContext) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, organizationId },
      });
      if (!invoice) throw AppError.notFound('Invoice not found');
      if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: `A ${invoice.status} invoice cannot receive STK payments.`,
          silent: true,
        });
      }
      const amount = toDec(input.amount);
      if (amount.greaterThan(invoice.balanceDue)) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: `STK amount of ${input.amount} exceeds the outstanding balance of ${invoice.balanceDue.toFixed(2)}.`,
          silent: true,
        });
      }

      let receipt: { merchantRequestId: string; checkoutRequestId: string };
      try {
        receipt = await this.provider.stkPush({
          phone: input.phone,
          amount: amount.toFixed(2),
          reference: invoice.invoiceNumber,
          branchId: invoice.branchId,
        });
      } catch {
        throw new AppError({
          code: ErrorCodes.MPESA_PROVIDER_UNAVAILABLE,
          message: 'The M-PESA provider is temporarily unavailable.',
        });
      }

      const request = await ctx.db.mpesaRequest.create({
        data: {
          id: newId(),
          organizationId,
          branchId: invoice.branchId,
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          phone: input.phone,
          amount,
          checkoutRequestId: receipt.checkoutRequestId,
          merchantRequestId: receipt.merchantRequestId,
          status: 'PENDING',
          initiatedById: actorId,
          initiatedAt: new Date(),
        },
      });

      ctx.emit({
        type: EventTypes.StkPushInitiated,
        aggregateType: 'mpesa_request',
        aggregateId: request.id,
        payload: { requestId: request.id, invoiceId: invoice.id, patientId: invoice.patientId },
      });

      return this.serializeRequest(request);
    });
  }

  async listRequests(query: ListRequestsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db().mpesaRequest.findMany({
        where,
        orderBy: { initiatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db().mpesaRequest.count({ where }),
    ]);
    return { items: items.map((r) => this.serializeRequest(r)), page, limit, total };
  }

  async getRequest(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const request = await this.db().mpesaRequest.findFirst({
      where: { id, organizationId },
    });
    if (!request) throw AppError.notFound('M-PESA request not found');
    return this.serializeRequest(request);
  }

  /** Offline status query against the provider for an in-flight request. */
  async statusQuery(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const request = await this.db().mpesaRequest.findFirst({
      where: { id, organizationId },
    });
    if (!request) throw AppError.notFound('M-PESA request not found');

    const status = await this.provider.queryStatus({
      merchantRequestId: request.merchantRequestId,
      checkoutRequestId: request.checkoutRequestId,
    });
    return {
      requestId: request.id,
      status: request.status,
      resultCode: request.resultCode ?? status.resultCode,
      resultDesc: request.resultDesc ?? status.resultDesc,
    };
  }

  // ─── Callback (public webhook) ─────────────────────────────────────────────

  /**
   * Processes an STK callback. Returns the Daraja ack so the telco stops
   * retrying. Unknown requests are acknowledged (200 no-op). Unauthorized
   * (missing/wrong secret) throws 401 so webhooks are rejected loudly.
   */
  async handleCallback(secret: string | undefined, body: unknown) {
    if (secret !== this.env.MPESA_CALLBACK_SECRET) {
      throw new AppError({
        code: ErrorCodes.MPESA_CALLBACK_UNAUTHORIZED,
        message: 'Invalid M-PESA callback secret.',
        silent: true,
      });
    }
    const parsed = parseCallback(body);
    if (!parsed) {
      throw AppError.badRequest('Malformed STK callback body.');
    }

    // The request row is found unscoped: the callback carries no tenant header.
    const row = await this.prisma.unscoped().mpesaRequest.findUnique({
      where: { merchantRequestId: parsed.merchantRequestId },
    });
    if (!row) {
      return this.callbackAck();
    }

    if (this.provider instanceof MockImpl) {
      this.provider.recordWebhook({
        merchantRequestId: parsed.merchantRequestId,
        checkoutRequestId: parsed.checkoutRequestId,
        amount: parsed.amount ?? row.amount.toFixed(2),
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc,
      });
    }

    await this.txRunner.run(
      async (ctx) => {
        await this.processCallback(ctx, row, parsed);
      },
      { organizationId: row.organizationId },
    );

    return this.callbackAck();
  }

  private async processCallback(
    ctx: TxContext,
    row: {
      id: string;
      organizationId: string;
      invoiceId: string;
      patientId: string;
      amount: Prisma.Decimal;
      status: string;
    },
    parsed: StkCallbackParsed,
  ): Promise<void> {
    const now = new Date();
    const isSuccess = parsed.resultCode === '0';
    const amount = parsed.amount ? toDec(parsed.amount) : row.amount;
    const amountMatches = amount.equals(row.amount);

    if (!isSuccess) {
      const guard = await ctx.db.mpesaRequest.updateMany({
        where: { id: row.id, organizationId: row.organizationId, status: 'PENDING' },
        data: {
          status: 'FAILED',
          resultCode: parsed.resultCode,
          resultDesc: parsed.resultDesc,
          rawCallback: bodyJson(parsed),
          callbackReceivedAt: now,
        },
      });
      if (guard.count !== 1) return; // duplicate/late — already terminal
      ctx.emit({
        type: EventTypes.PaymentFailed,
        aggregateType: 'mpesa_request',
        aggregateId: row.id,
        payload: { requestId: row.id, invoiceId: row.invoiceId },
      });
      return;
    }

    if (!amountMatches) {
      const guard = await ctx.db.mpesaRequest.updateMany({
        where: { id: row.id, organizationId: row.organizationId, status: 'PENDING' },
        data: {
          status: 'MISMATCHED',
          resultCode: parsed.resultCode,
          resultDesc: parsed.resultDesc,
          rawCallback: bodyJson(parsed),
          callbackReceivedAt: now,
        },
      });
      if (guard.count !== 1) return;
      return; // no payment recorded — reconciliation will flag the charge.
    }

    // Confirmed at the requested amount: the payment becomes real now.
    const guard = await ctx.db.mpesaRequest.updateMany({
      where: { id: row.id, organizationId: row.organizationId, status: 'PENDING' },
      data: {
        status: 'SUCCEEDED',
        resultCode: parsed.resultCode,
        resultDesc: parsed.resultDesc,
        rawCallback: bodyJson(parsed),
        callbackReceivedAt: now,
        confirmedAt: now,
      },
    });
    if (guard.count !== 1) return; // exactly-once: a concurrent callback won.

    const invoice = await ctx.db.invoice.findFirst({
      where: { id: row.invoiceId, organizationId: row.organizationId },
    });
    if (!invoice) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Callback confirmed for an invoice that no longer exists.',
      });
    }

    const balanceGuard = await ctx.db.invoice.updateMany({
      where: {
        id: invoice.id,
        organizationId: row.organizationId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        balanceDue: { gte: amount },
      },
      data: { balanceDue: { decrement: amount } },
    });
    if (balanceGuard.count !== 1) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'Callback amount exceeds the current outstanding balance.',
      });
    }

    const id = newId();
    const seq = await nextBillingSequence(ctx.db, row.organizationId, 'receipt');
    const payment = await ctx.db.payment.create({
      data: {
        id,
        organizationId: row.organizationId,
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        receiptNumber: formatBillingNumber('receipt', seq),
        amount,
        method: 'MPESA',
        status: 'COMPLETED',
        externalReference: parsed.checkoutRequestId,
        note: `M-PESA STK push confirmed (${parsed.checkoutRequestId})`,
        recordedAt: now,
      },
    });

    const fresh = await ctx.db.invoice.findUnique({ where: { id: invoice.id } });
    if (!fresh) throw new AppError({ code: ErrorCodes.INTERNAL_ERROR, message: 'Invoice disappeared' });
    const target = settleInvoiceStatus(fresh.total, fresh.balanceDue);
    await this.workflows.assertAllowed(ctx.db, row.organizationId, 'invoice', fresh.status, target);
    const settle = await ctx.db.invoice.updateMany({
      where: { id: invoice.id, organizationId: row.organizationId },
      data: { status: target, version: { increment: 1 } },
    });
    if (settle.count !== 1) {
      throw new AppError({
        code: ErrorCodes.CONCURRENT_MODIFICATION,
        message: 'Invoice changed while its STK payment was settled.',
      });
    }

    ctx.emit({
      type: EventTypes.PaymentCompleted,
      aggregateType: 'payment',
      aggregateId: payment.id,
      payload: { paymentId: payment.id, invoiceId: invoice.id, patientId: invoice.patientId },
    });
    ctx.emit({
      type: EventTypes.PaymentConfirmed,
      aggregateType: 'mpesa_request',
      aggregateId: row.id,
      payload: { requestId: row.id, paymentId: payment.id },
    });
  }

  // ─── Reconciliation ────────────────────────────────────────────────────────

  async reconcile(input: ReconcileDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const to = input.to ? new Date(input.to) : new Date();
    const from = input.from ? new Date(input.from) : new Date(to.getTime() - 24 * 3600 * 1000);

    return this.txRunner.run(async (ctx: TxContext) => {
      const [providerTxs, payments, requests] = await Promise.all([
        this.provider.listProviderTransactions({ windowFrom: from, windowTo: to }),
        ctx.db.payment.findMany({
          where: {
            organizationId,
            method: 'MPESA',
            recordedAt: { gte: from, lte: to },
            externalReference: { not: null },
          },
          select: { id: true, externalReference: true, amount: true, method: true },
        }),
        ctx.db.mpesaRequest.findMany({
          where: {
            organizationId,
            initiatedAt: { gte: from, lte: to },
          },
          select: { id: true, checkoutRequestId: true, status: true },
        }),
      ]);

      const requestByReference = new Map<string, string>();
      for (const r of requests) {
        if (!requestByReference.has(r.checkoutRequestId)) {
          requestByReference.set(r.checkoutRequestId, r.id);
        }
      }

      const drafts = classifyPayment(
        providerTxs.map((t) => ({
          checkoutRequestId: t.checkoutRequestId,
          amount: toDec(t.amount),
          kind: t.kind as 'SUCCEEDED' | 'MISMATCHED' | 'FAILED',
        })),
        payments.map((p) => ({
          id: p.id,
          externalReference: p.externalReference,
          amount: p.amount,
          method: p.method,
        })),
      );

      const counts = {
        providerCount: providerTxs.length,
        paymentCount: payments.length,
        matchedCount: 0,
        unmatchedCount: 0,
        duplicateCount: 0,
        amountMismatchCount: 0,
        referenceMismatchCount: 0,
      };
      for (const d of drafts) {
        if (d.status === 'MATCHED') counts.matchedCount += 1;
        else if (d.status === 'UNMATCHED') counts.unmatchedCount += 1;
        else if (d.status === 'DUPLICATE') counts.duplicateCount += 1;
        else if (d.status === 'AMOUNT_MISMATCH') counts.amountMismatchCount += 1;
        else counts.referenceMismatchCount += 1;
      }

      const run = await ctx.db.mpesaReconciliationRun.create({
        data: {
          id: newId(),
          organizationId,
          windowFrom: from,
          windowTo: to,
          ...counts,
          runById: actorId,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });

      const rows = [];
      for (const d of drafts) {
        rows.push(
          await ctx.db.mpesaReconciliationMatch.create({
            data: {
              id: newId(),
              organizationId,
              runId: run.id,
              mpesaRequestId: requestByReference.get(d.reference) ?? null,
              paymentId: d.paymentId,
              reference: d.reference,
              status: d.status,
              expectedAmount: d.expectedAmount,
              providerAmount: d.providerAmount,
              notes: d.notes,
            },
          }),
        );
      }

      ctx.emit({
        type: EventTypes.ReconciliationCompleted,
        aggregateType: 'mpesa_reconciliation_run',
        aggregateId: run.id,
        payload: { runId: run.id, matchedCount: counts.matchedCount },
      });

      return { run: this.serializeRun(run), matches: rows.map((m) => this.serializeMatch(m)) };
    });
  }

  async listReconciliations(query: ListReconciliationsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { organizationId };
    const [items, total] = await Promise.all([
      this.db().mpesaReconciliationRun.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db().mpesaReconciliationRun.count({ where }),
    ]);
    return { items: items.map((r) => this.serializeRun(r)), page, limit, total };
  }

  async getReconciliation(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const run = await this.db().mpesaReconciliationRun.findFirst({
      where: { id, organizationId },
    });
    if (!run) throw AppError.notFound('Reconciliation run not found');
    const matches = await this.db().mpesaReconciliationMatch.findMany({
      where: { organizationId, runId: run.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      run: this.serializeRun(run),
      matches: matches.map((m) => this.serializeMatch(m)),
    };
  }

  async resolveMatch(id: string, input: ResolveMatchDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    return this.txRunner.run(async (ctx) => {
      const match = await ctx.db.mpesaReconciliationMatch.findFirst({
        where: { id, organizationId },
      });
      if (!match) throw AppError.notFound('Reconciliation match not found');
      if (match.resolution) {
        throw new AppError({
          code: ErrorCodes.RECONCILIATION_ALREADY_RESOLVED,
          message: 'This reconciliation match was already resolved.',
          silent: true,
        });
      }
      const updated = await ctx.db.mpesaReconciliationMatch.update({
        where: { id: match.id },
        data: {
          resolution: input.resolution,
          resolutionReason: input.reason,
          resolvedById: actorId,
          resolvedAt: new Date(),
        },
      });
      return this.serializeMatch(updated);
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private db() {
    return this.prisma.tenant;
  }

  private callbackAck() {
    return { ResultCode: '0', ResultDesc: 'Success' };
  }

  private serializeRequest(r: {
    id: string;
    organizationId: string;
    branchId: string | null;
    invoiceId: string;
    patientId: string;
    phone: string;
    amount: Prisma.Decimal;
    checkoutRequestId: string;
    merchantRequestId: string;
    status: string;
    resultCode: string | null;
    resultDesc: string | null;
    initiatedById: string | null;
    initiatedAt: Date;
    callbackReceivedAt: Date | null;
    confirmedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return { ...r, amount: r.amount.toFixed(2) };
  }

  private serializeRun(r: {
    id: string;
    windowFrom: Date;
    windowTo: Date;
    providerCount: number;
    paymentCount: number;
    matchedCount: number;
    unmatchedCount: number;
    duplicateCount: number;
    amountMismatchCount: number;
    referenceMismatchCount: number;
    runById: string | null;
    startedAt: Date;
    completedAt: Date;
    createdAt: Date;
  }) {
    return { ...r };
  }

  private serializeMatch(m: {
    id: string;
    runId: string;
    reference: string;
    status: string;
    expectedAmount: Prisma.Decimal | null;
    providerAmount: Prisma.Decimal | null;
    notes: string | null;
    resolution: string | null;
    resolutionReason: string | null;
    resolvedById: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      ...m,
      expectedAmount: m.expectedAmount ? m.expectedAmount.toFixed(2) : undefined,
      providerAmount: m.providerAmount ? m.providerAmount.toFixed(2) : undefined,
    };
  }
}

function toDec(value: string | number | Prisma.Decimal): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(String(value)).toDecimalPlaces(2);
}

function parseCallback(body: unknown): StkCallbackParsed | null {
  return parseStkCallback(body);
}

function bodyJson(parsed: StkCallbackParsed): Prisma.InputJsonObject {
  return {
    merchantRequestId: parsed.merchantRequestId,
    checkoutRequestId: parsed.checkoutRequestId,
    resultCode: parsed.resultCode,
    resultDesc: parsed.resultDesc,
    amount: parsed.amount,
  } as Prisma.InputJsonObject;
}