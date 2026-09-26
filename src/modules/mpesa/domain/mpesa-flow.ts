import { Prisma } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * M-PESA reconciliation core (repo Phase 11).
 *
 * Pure classification of provider-side STK transactions vs the internal
 * MPESA payment rows for a window. Every distinct reference produces exactly
 * one verdict:
 *
 *   MATCHED            provider tx + matching MPESA payment, same amount
 *   UNMATCHED          provider tx with no book row (or book row with none)
 *   DUPLICATE          more than one provider tx for the same reference
 *   AMOUNT_MISMATCH    payment exists but provider charged a different amount
 *   REFERENCE_MISMATCH the reference belongs to a non-MPESA payment
 *
 * Resolutions are audited stamps only — they never mutate the underlying
 * payment/request rows (see ADR-035).
 */

export type ReconcileVerdict =
  | 'MATCHED'
  | 'UNMATCHED'
  | 'DUPLICATE'
  | 'AMOUNT_MISMATCH'
  | 'REFERENCE_MISMATCH';

export interface ProviderTxView {
  checkoutRequestId: string;
  amount: Decimal;
  /** Only SUCCEEDED provider transactions moved money. */
  kind: 'SUCCEEDED' | 'MISMATCHED' | 'FAILED';
}

export interface BookPaymentView {
  id: string;
  externalReference: string | null;
  amount: Decimal;
  method: string;
}

export interface ReconciliationDraft {
  reference: string;
  status: ReconcileVerdict;
  expectedAmount: Decimal | null;
  providerAmount: Decimal | null;
  notes: string | null;
  mpesaRequestId: string | null;
  paymentId: string | null;
}

const zero = new Prisma.Decimal(0);

export function classifyPayment(
  providerTxs: ProviderTxView[],
  payments: BookPaymentView[],
): ReconciliationDraft[] {
  // Providers only move money on SUCCEEDED pushes — a FAILED webhook charged
  // nothing and needs no reconciliation row.
  const movers = providerTxs.filter((t) => t.kind === 'SUCCEEDED' || t.kind === 'MISMATCHED');

  const byReference = new Map<string, ProviderTxView[]>();
  for (const t of movers) {
    const list = byReference.get(t.checkoutRequestId) ?? [];
    list.push(t);
    byReference.set(t.checkoutRequestId, list);
  }

  const bookByReference = new Map<string, BookPaymentView>();
  for (const p of payments) {
    if (!p.externalReference) continue;
    // A reference should belong to exactly one payment; keep the first.
    if (!bookByReference.has(p.externalReference)) {
      bookByReference.set(p.externalReference, p);
    }
  }

  const references = new Set<string>([
    ...byReference.keys(),
    ...bookByReference.keys(),
  ]);

  const drafts: ReconciliationDraft[] = [];
  for (const reference of references) {
    const providerList = byReference.get(reference) ?? [];
    const payment = bookByReference.get(reference);

    if (providerList.length === 0) {
      // Book row with no provider record: the telco never confirmed it.
      drafts.push({
        reference,
        status: 'UNMATCHED',
        expectedAmount: payment?.amount ?? null,
        providerAmount: null,
        notes: 'Payment recorded in the books but absent from the provider statement.',
        mpesaRequestId: null,
        paymentId: payment?.id ?? null,
      });
      continue;
    }

    const provider = providerList[0]!;
    if (providerList.length > 1) {
      drafts.push({
        reference,
        status: 'DUPLICATE',
        expectedAmount: payment?.amount ?? zero,
        providerAmount: provider.amount,
        notes: `Provider statement lists ${providerList.length} transactions for this reference.`,
        mpesaRequestId: null,
        paymentId: payment?.id ?? null,
      });
      continue;
    }

    if (!payment) {
      drafts.push({
        reference,
        status: 'UNMATCHED',
        expectedAmount: null,
        providerAmount: provider.amount,
        notes:
          provider.kind === 'MISMATCHED'
            ? 'Callback arrived with an amount that differed from the STK request; no payment was recorded.'
            : 'Provider confirms a charge but the books have no corresponding payment.',
        mpesaRequestId: null,
        paymentId: null,
      });
      continue;
    }

    if (payment.method !== 'MPESA') {
      drafts.push({
        reference,
        status: 'REFERENCE_MISMATCH',
        expectedAmount: payment.amount,
        providerAmount: provider.amount,
        notes: `Reference belongs to a ${payment.method} payment; it should not appear on the M-PESA statement.`,
        mpesaRequestId: null,
        paymentId: payment.id,
      });
      continue;
    }

    if (!payment.amount.equals(provider.amount)) {
      drafts.push({
        reference,
        status: 'AMOUNT_MISMATCH',
        expectedAmount: payment.amount,
        providerAmount: provider.amount,
        notes: 'Booked amount differs from the provider amount.',
        mpesaRequestId: null,
        paymentId: payment.id,
      });
      continue;
    }

    drafts.push({
      reference,
      status: 'MATCHED',
      expectedAmount: payment.amount,
      providerAmount: provider.amount,
      notes: null,
      mpesaRequestId: null,
      paymentId: payment.id,
    });
  }

  return drafts;
}

export function assertResolutionAllowed(value: string): void {
  if (!['VERIFIED', 'CORRECTED', 'PAID_OUT_OF_BAND', 'DUPLICATE_REFUNDED', 'WRITTEN_OFF', 'ESCALATED'].includes(value)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: "Resolution must be one of VERIFIED, CORRECTED, PAID_OUT_OF_BAND, DUPLICATE_REFUNDED, WRITTEN_OFF, ESCALATED.",
      silent: true,
    });
  }
}