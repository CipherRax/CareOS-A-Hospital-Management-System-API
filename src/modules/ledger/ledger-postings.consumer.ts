import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { newId } from '../../common/lib/uuidv7';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import type {
  OutboxConsumer,
  OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import {
  assertBalancedJournal,
  normalizeJournalLine,
  planAutoPosting,
  resolveJournalPeriod,
  toMoney,
} from './domain/ledger-flow';
import { DEFAULT_CHART_ACCOUNTS } from './domain/ledger-accounts';

/**
 * Auto-posting ledger consumer (repo Phase 11, ADR-035).
 *
 * Subscribes to the billing lifecycle events and posts the double-entry
 * journals the chartered map produces:
 *   InvoiceIssued      DR AR(1200) / CR Revenue(4000)
 *   InvoiceCancelled   DR Revenue(4000) / CR AR(1200)     (only if it was issued)
 *   PaymentCompleted   DR Cash(1000)  / CR AR(1200)       (any method)
 *   PaymentRefunded    DR AR(1200)    / CR Cash(1000)
 *
 * Idempotency: referenceType/referenceId map exactly to the source event type
 * and aggregate id, and `FinanceTransaction` has a unique index on
 * (organizationId, referenceType, referenceId) — replays/retries are no-ops
 * even if a ProcessedEvent row is lost. MANUAL journals always use NULL
 * references, so they can never collide.
 *
 * Period lock: when the journal date falls into a CLOSED/LOCKED period, the
 * consumer writes an auditable LedgerPostingException and returns NORMALLY —
 * it never throws, so the outbox row is acked and the timeline consumer on the
 * same row is not poisoned by the ledger's policy (see ADR-035).
 */
@Injectable()
export class LedgerPostingConsumer implements OutboxConsumer {
  readonly name = 'ledger-posting';

  readonly eventTypes: ReadonlyArray<string> = [
    EventTypes.InvoiceIssued,
    EventTypes.InvoiceCancelled,
    EventTypes.PaymentCompleted,
    EventTypes.PaymentRefunded,
  ];

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = asRecord(ctx.row.payload);
    const organizationId = ctx.organizationId;

    try {
      await this.postForEvent(ctx, payload);
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCodes.PERIOD_LOCKED) {
        await ctx.db.ledgerPostingException.create({
          data: {
            id: newId(),
            organizationId,
            eventId: ctx.row.id,
            eventType: ctx.row.type,
            referenceType: ctx.row.type,
            referenceId: String(
              payload.paymentId ?? payload.invoiceId ?? ctx.row.aggregateId,
            ),
            reason: err.message,
            createdAt: new Date(),
          },
        });
        return;
      }
      throw err;
    }
  }

  private async postForEvent(
    ctx: OutboxConsumerContext,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { referenceType, referenceId, date, amount } = await this.resolveSource(
      ctx,
      payload,
    );
    if (!referenceType) return;

    // Insufficient data to post safely (e.g. a DRAFT invoice cancelled before
    // it was ever issued) — skip silently; nothing to reverse.
    if (referenceId === null) return;

    await this.postJournal(ctx, {
      referenceType,
      referenceId,
      date,
      description: referenceType,
      amount,
    });
  }

  /** Loads the source aggregate and derives the reference + posting amount. */
  private async resolveSource(
    ctx: OutboxConsumerContext,
    payload: Record<string, unknown>,
  ): Promise<{
    referenceType: string | null;
    referenceId: string | null;
    date: Date;
    amount: Prisma.Decimal;
  }> {
    const organizationId = ctx.organizationId;

    if (ctx.row.type === EventTypes.InvoiceIssued) {
      const invoiceId = firstString(payload.invoiceId) ?? ctx.row.aggregateId;
      // The invoice may already be PARTIALLY_PAID/PAID when a same-second
      // PaymentCompleted outbox row is processed first (ordering is by
      // occurredAt, not guaranteed across ms ties). What matters is that it was
      // issued and has not been cancelled.
      const invoice = await ctx.db.invoice.findFirst({
        where: {
          id: invoiceId,
          organizationId,
          issuedAt: { not: null },
          status: { not: 'CANCELLED' },
        },
        select: { id: true, total: true, issuedAt: true },
      });
      if (!invoice) return empty();
      return {
        referenceType: EventTypes.InvoiceIssued,
        referenceId: invoice.id,
        date: invoice.issuedAt ?? ctx.row.occurredAt,
        amount: toMoney(invoice.total),
      };
    }

    if (ctx.row.type === EventTypes.InvoiceCancelled) {
      const invoiceId = firstString(payload.invoiceId) ?? ctx.row.aggregateId;
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: invoiceId, organizationId, status: 'CANCELLED' },
        select: { id: true, total: true, issuedAt: true, cancelledAt: true },
      });
      // Only invoices that were actually issued went to the books; a DRAFT
      // cancelled before issue never touched revenue or AR.
      if (!invoice || invoice.issuedAt === null) return empty();
      return {
        referenceType: EventTypes.InvoiceCancelled,
        referenceId: invoice.id,
        date: invoice.cancelledAt ?? ctx.row.occurredAt,
        amount: toMoney(invoice.total),
      };
    }

    if (ctx.row.type === EventTypes.PaymentCompleted) {
      const paymentId = firstString(payload.paymentId) ?? ctx.row.aggregateId;
      const payment = await ctx.db.payment.findFirst({
        where: { id: paymentId, organizationId },
        select: { id: true, amount: true, recordedAt: true },
      });
      if (!payment) return empty();
      return {
        referenceType: EventTypes.PaymentCompleted,
        referenceId: payment.id,
        date: payment.recordedAt ?? ctx.row.occurredAt,
        amount: toMoney(payment.amount),
      };
    }

    if (ctx.row.type === EventTypes.PaymentRefunded) {
      const paymentId = firstString(payload.paymentId) ?? ctx.row.aggregateId;
      const payment = await ctx.db.payment.findFirst({
        where: { id: paymentId, organizationId },
        select: { id: true, amount: true, refundedAt: true },
      });
      if (!payment) return empty();
      return {
        referenceType: EventTypes.PaymentRefunded,
        referenceId: payment.id,
        date: payment.refundedAt ?? ctx.row.occurredAt,
        amount: toMoney(payment.amount),
      };
    }

    return empty();
  }

  private async postJournal(
    ctx: OutboxConsumerContext,
    source: { referenceType: string; referenceId: string; date: Date; description: string; amount: Prisma.Decimal },
  ): Promise<void> {
    const organizationId = ctx.organizationId;

    // Seeding is cheap and idempotent: the default chart is ensured before any
    // posting so journal creation never fails on missing accounts.
    const accounts = new Map<string, string>();
    for (const def of DEFAULT_CHART_ACCOUNTS) {
      const row = await ctx.db.chartAccount.upsert({
        where: { organizationId_code: { organizationId, code: def.code } },
        create: {
          id: newId(),
          organizationId,
          code: def.code,
          name: def.name,
          category: def.category,
          normalBalance: def.normalBalance,
          description: def.description ?? null,
        },
        update: {},
      });
      accounts.set(row.code, row.id);
    }

    const plan = planAutoPosting({
      referenceType: source.referenceType as never,
      referenceId: source.referenceId,
      date: source.date,
      description: source.description,
      amount: source.amount,
    });
    const lines = plan.map((l) => normalizeJournalLine(l, accounts));
    assertBalancedJournal(lines);

    const periods = await ctx.db.financialPeriod.findMany({
      where: { organizationId },
      select: { id: true, status: true, startDate: true, endDate: true },
    });
    // PERIOD_LOCKED propagates to the caller, which records an exception.
    const period = resolveJournalPeriod(periods, source.date);

    try {
      await ctx.db.financeTransaction.create({
        data: {
          id: newId(),
          organizationId,
          transactionNumber: `AUTO-${source.referenceType}-${source.referenceId.replace(/[:]/g, '')}`.slice(0, 80),
          date: source.date,
          periodId: period?.id ?? null,
          description: source.description,
          referenceType: source.referenceType,
          referenceId: source.referenceId,
          status: 'POSTED',
          postedAt: new Date(),
          lines: {
            create: lines.map((l) => ({
              id: newId(),
              organizationId,
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              memo: l.memo,
            })),
          },
        },
      });
    } catch (err) {
      // Unique (organizationId, referenceType, referenceId) — already posted.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }
}

function empty(): {
  referenceType: null;
  referenceId: null;
  date: Date;
  amount: Prisma.Decimal;
} {
  return {
    referenceType: null,
    referenceId: null,
    date: new Date(),
    amount: new Prisma.Decimal(0),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}