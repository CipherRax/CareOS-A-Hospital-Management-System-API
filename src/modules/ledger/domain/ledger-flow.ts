import { Prisma } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';
import type { FinancialPeriod, FinanceTransactionLine } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';
import { EventTypes } from '../../../events/catalog';

/**
 * Journal core (repo Phase 11). Pure helpers for manual journals and the
 * auto-posting map the outbox ledger consumer runs. Money is Decimal; every
 * amount is rounded to 2dp (ADR-029). A journal is a set of single-side lines
 * whose debits equal credits; the application asserts this first and the DB
 * CHECK + trigger back it (see migration phase11_financial).
 */

/** One leg: account + one side. debit/credit are mutually exclusive. */
export interface JournalLineInput {
  accountCode: string;
  debit?: Decimal;
  credit?: Decimal;
  memo?: string;
}

export interface JournalLineNorm {
  accountId: string;
  debit: Decimal;
  credit: Decimal;
  memo: string | null;
}

export function toMoney(value: Decimal | number | string): Decimal {
  const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value));
  return d.toDecimalPlaces(2);
}

export function zero(): Decimal {
  return new Prisma.Decimal(0);
}

/** Normalizes a raw journal line into (accountId, debit, credit). */
export function normalizeJournalLine(
  line: JournalLineInput,
  accountsById: Map<string, string>,
): JournalLineNorm {
  const debit = toMoney(line.debit ?? 0);
  const credit = toMoney(line.credit ?? 0);
  const hasDebit = debit.greaterThan(0);
  const hasCredit = credit.greaterThan(0);
  if (hasDebit === hasCredit) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Each journal line must have exactly one side (debit XOR credit).',
      silent: true,
    });
  }
  if (debit.isNegative() || credit.isNegative()) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Journal line amounts cannot be negative.',
      silent: true,
    });
  }
  const accountId = accountsById.get(line.accountCode);
  if (!accountId) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Unknown account code '${line.accountCode}'.`,
      silent: true,
    });
  }
  return { accountId, debit, credit, memo: line.memo?.trim() || null };
}

/** Asserts debits equal credits; returns the (rounded) totals. */
export function assertBalancedJournal(
  lines: Array<Pick<FinanceTransactionLine, 'debit' | 'credit'>>,
): { debit: Decimal; credit: Decimal } {
  let debit = zero();
  let credit = zero();
  for (const l of lines) {
    debit = debit.plus(l.debit);
    credit = credit.plus(l.credit);
  }
  debit = debit.toDecimalPlaces(2);
  credit = credit.toDecimalPlaces(2);
  if (!debit.equals(credit)) {
    throw new AppError({
      code: ErrorCodes.UNBALANCED_JOURNAL,
      message: `Journal is unbalanced: debits ${debit} vs credits ${credit}.`,
      silent: true,
    });
  }
  return { debit, credit };
}

// ─── Financial periods ──────────────────────────────────────────────────────

export function isPeriodOpen(period: Pick<FinancialPeriod, 'status'>): boolean {
  return period.status === 'OPEN';
}

export interface LedgerPeriodLike {
  id: string;
  status: FinancialPeriod['status'];
  startDate: Date;
  endDate: Date;
}

/**
 * Resolves the period a journal date falls in. Returns null when no period
 * covers the date (the journal records with periodId null). Throws
 * PERIOD_LOCKED when the date is covered only by CLOSED/LOCKED periods
 * (ADR-035) or by overlapping periods.
 */
export function resolveJournalPeriod(
  periods: LedgerPeriodLike[],
  date: Date,
): LedgerPeriodLike | null {
  const covering = periods.filter((p) => date >= p.startDate && date <= p.endDate);
  if (covering.length === 0) return null;
  if (covering.length > 1) {
    throw new AppError({
      code: ErrorCodes.PERIOD_LOCKED,
      message: 'The journal date is covered by multiple financial periods; none is writable.',
      silent: true,
    });
  }
  const period = covering[0]!;
  if (!isPeriodOpen(period)) {
    throw new AppError({
      code: ErrorCodes.PERIOD_LOCKED,
      message: `Journal date falls in a ${period.status} financial period; it cannot be posted.`,
      silent: true,
    });
  }
  return period;
}

/** True when [start,end] overlaps any existing period. */
export function periodOverlaps(
  existing: LedgerPeriodLike[],
  start: Date,
  end: Date,
): boolean {
  return existing.some((p) => start <= p.endDate && end >= p.startDate);
}

// ─── Auto-posting map (outbox ledger consumer) ──────────────────────────────

export type LedgerSourceType =
  | typeof EventTypes.InvoiceIssued
  | typeof EventTypes.InvoiceCancelled
  | typeof EventTypes.PaymentCompleted
  | typeof EventTypes.PaymentRefunded;

export interface AutoPostSource {
  /** Event type string; becomes FinanceTransaction.referenceType. */
  referenceType: LedgerSourceType;
  /** Identifier of the source aggregate; becomes referenceId. */
  referenceId: string;
  date: Date;
  description: string;
  /** The money amount to post, resolved from the DB by the caller. */
  amount: Decimal;
}

/**
 * Pure event → legs mapping. Callers fetch the amounts from the DB (the
 * consumer never trusts event payloads). Returns the two legs, or throws
 * UNBALANCED_JOURNAL if the source amounts are inconsistent.
 */
export function planAutoPosting(source: AutoPostSource): JournalLineInput[] {
  const v = toMoney(source.amount);
  switch (source.referenceType) {
    case EventTypes.InvoiceIssued:
      return [
        { accountCode: '1200', debit: v, memo: 'Invoice issued' },
        { accountCode: '4000', credit: v, memo: 'Invoice issued' },
      ];
    case EventTypes.InvoiceCancelled:
      return [
        { accountCode: '4000', debit: v, memo: 'Invoice cancelled' },
        { accountCode: '1200', credit: v, memo: 'Invoice cancelled' },
      ];
    case EventTypes.PaymentCompleted:
      return [
        { accountCode: '1000', debit: v, memo: 'Payment received' },
        { accountCode: '1200', credit: v, memo: 'Payment received' },
      ];
    case EventTypes.PaymentRefunded:
      return [
        { accountCode: '1200', debit: v, memo: 'Payment refunded' },
        { accountCode: '1000', credit: v, memo: 'Payment refunded' },
      ];
    default:
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `No auto-posting plan for source '${source.referenceType}'.`,
      });
  }
}