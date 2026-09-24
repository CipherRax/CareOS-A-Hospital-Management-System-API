import type {
  Invoice,
  InvoiceStatus,
  ClaimStatus,
  InsuranceClaim,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/** A billed line after price resolution (unit price already a Decimal). */
export interface InvoiceLineInput {
  quantity: number;
  unitPrice: Decimal;
}

/**
 * Billing lifecycle core (brief Phase 7).
 *
 * Money is always Decimal (ADR-029: `Decimal(12,2)` surfaced as a string on
 * the wire). Every computed amount rounds to 2dp. Status machines below are
 * pure and complemented by the workflow engine: explicit transitions
 * (issue/cancel/refund, claim submit/decide/pay) are additionally asserted
 * against org-customizable workflows; balance-driven settle/revert of invoices
 * is derived state that reuses the same system edges so the engine stays
 * consistent with reality.
 */

export type InvoiceAction = 'issue' | 'cancel' | 'refund';
export type ClaimAction = 'submit' | 'approve' | 'partial_approve' | 'deny' | 'pay';

const INVOICE_ALLOWED_FROM: Record<InvoiceAction, readonly InvoiceStatus[]> = {
  issue: ['DRAFT'],
  cancel: ['DRAFT', 'ISSUED'],
  refund: ['PAID'],
};

const CLAIM_ALLOWED_FROM: Record<ClaimAction, readonly ClaimStatus[]> = {
  submit: ['DRAFT'],
  approve: ['SUBMITTED'],
  partial_approve: ['SUBMITTED'],
  deny: ['SUBMITTED'],
  pay: ['APPROVED', 'PARTIALLY_APPROVED'],
};

export function assertInvoiceAction(
  current: Pick<Invoice, 'status'>,
  action: InvoiceAction,
): InvoiceStatus {
  const target: Record<InvoiceAction, InvoiceStatus> = {
    issue: 'ISSUED',
    cancel: 'CANCELLED',
    refund: 'REFUNDED',
  };
  const allowed = INVOICE_ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} invoice cannot be ${action}ed.`,
      silent: true,
    });
  }
  return target[action];
}

export function assertClaimAction(
  current: Pick<InsuranceClaim, 'status'>,
  action: ClaimAction,
): ClaimStatus {
  const target: Record<ClaimAction, ClaimStatus> = {
    submit: 'SUBMITTED',
    approve: 'APPROVED',
    partial_approve: 'PARTIALLY_APPROVED',
    deny: 'DENIED',
    pay: 'PAID',
  };
  const allowed = CLAIM_ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} claim cannot be ${action}ed.`,
      silent: true,
    });
  }
  return target[action];
}

export function computeLineTotal(quantity: number, unitPrice: Decimal): Decimal {
  return new Prisma.Decimal(quantity).times(unitPrice).toDecimalPlaces(2);
}

export interface InvoiceTotalsInput {
  lines: Array<Pick<InvoiceLineInput, 'quantity' | 'unitPrice'>>;
  discountAmount?: Decimal;
  taxAmount?: Decimal;
}

/** subtotal = Σ line totals; total = subtotal − discount + tax (both clamp ≥ 0). */
export function computeInvoiceTotals(input: InvoiceTotalsInput): {
  subtotal: Decimal;
  total: Decimal;
} {
  const zero = new Prisma.Decimal(0);
  let subtotal = zero;
  for (const line of input.lines) {
    subtotal = subtotal.plus(computeLineTotal(line.quantity, line.unitPrice));
  }
  const discount = input.discountAmount ?? zero;
  const tax = input.taxAmount ?? zero;
  let total = subtotal.minus(discount).plus(tax);
  if (total.isNegative()) total = zero;
  return { subtotal, total: total.toDecimalPlaces(2) };
}

/**
 * The invoice status implied by a balance after a payment is settled or
 * refunded: nothing collected → ISSUED, fully collected → PAID, in between →
 * PARTIALLY_PAID. These are derived states (like OVERDUE) — they are not
 * terminal and can flip in either direction as payments move.
 */
export function settleInvoiceStatus(total: Decimal, balanceDue: Decimal): InvoiceStatus {
  if (total.greaterThan(0) && balanceDue.greaterThanOrEqualTo(total)) return 'ISSUED';
  if (balanceDue.lessThanOrEqualTo(0)) return 'PAID';
  return 'PARTIALLY_PAID';
}

/** Throws when a settlement exceeds what the patient still owes. */
export function assertPaymentWithinBalance(amount: Decimal, balanceDue: Decimal): void {
  if (amount.greaterThan(balanceDue)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Payment of ${amount} exceeds the outstanding balance of ${balanceDue}.`,
      silent: true,
    });
  }
}

export function isMoneyRoundedToCents(value: Decimal): boolean {
  return value.toDecimalPlaces(2).equals(value);
}