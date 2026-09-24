import { Prisma } from '@prisma/client';
import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertClaimAction,
  assertInvoiceAction,
  assertPaymentWithinBalance,
  computeInvoiceTotals,
  computeLineTotal,
  settleInvoiceStatus,
} from '../../../src/modules/billing/domain/billing-flow';

function dec(n: string | number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

describe('billing-flow: money', () => {
  it('computes line totals as quantity × unit price, rounded to cents', () => {
    expect(computeLineTotal(3, dec('1500.10')).toFixed(2)).toBe('4500.30');
    expect(computeLineTotal(2, dec('99.995')).toFixed(2)).toBe('199.99');
  });

  it('computes subtotal and total honoring discount + tax', () => {
    const { subtotal, total } = computeInvoiceTotals({
      lines: [
        { quantity: 2, unitPrice: dec('500') },
        { quantity: 1, unitPrice: dec('1000') },
        { quantity: 1, unitPrice: dec('750.50') },
      ],
      discountAmount: dec('250.50'),
      taxAmount: dec('100'),
    });
    expect(subtotal.toFixed(2)).toBe('2750.50');
    expect(total.toFixed(2)).toBe('2600.00');
  });

  it('never lets a discount drive the total below zero', () => {
    const { total } = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: dec('100') }],
      discountAmount: dec('500'),
      taxAmount: dec('0'),
    });
    expect(total.toString()).toBe('0');
  });

  it('defaults missing discount/tax to zero', () => {
    const { subtotal, total } = computeInvoiceTotals({
      lines: [{ quantity: 1, unitPrice: dec('100') }],
    });
    expect(subtotal.toString()).toBe('100');
    expect(total.toString()).toBe('100');
  });
});

describe('billing-flow: settle status', () => {
  it('classifies balances: nothing paid, partial, fully paid', () => {
    expect(settleInvoiceStatus(dec(1000), dec(1000))).toBe('ISSUED');
    expect(settleInvoiceStatus(dec(1000), dec(400))).toBe('PARTIALLY_PAID');
    expect(settleInvoiceStatus(dec(1000), dec(0))).toBe('PAID');
  });

  it('reverts a PAID invoice back through the partial states on refund', () => {
    expect(settleInvoiceStatus(dec(1000), dec(300))).toBe('PARTIALLY_PAID');
    expect(settleInvoiceStatus(dec(1000), dec(1000))).toBe('ISSUED');
  });
});

describe('billing-flow: payment within balance', () => {
  it('accepts a payment that fits the outstanding balance', () => {
    expect(() => assertPaymentWithinBalance(dec(1500), dec('1500.00'))).not.toThrow();
  });

  it('rejects an over-payment', () => {
    try {
      assertPaymentWithinBalance(dec('1500.01'), dec(1500));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});

describe('billing-flow: invoice status machine', () => {
  it('maps issue/cancel/refund to their target statuses', () => {
    expect(assertInvoiceAction({ status: 'DRAFT' }, 'issue')).toBe('ISSUED');
    expect(assertInvoiceAction({ status: 'ISSUED' }, 'cancel')).toBe('CANCELLED');
    expect(assertInvoiceAction({ status: 'PAID' }, 'refund')).toBe('REFUNDED');
  });

  it('rejects transitions from the wrong current status', () => {
    for (const [status, action] of [
      ['ISSUED', 'issue'],
      ['PAID', 'cancel'],
      ['ISSUED', 'refund'],
      ['CANCELLED', 'issue'],
    ] as const) {
      try {
        assertInvoiceAction({ status }, action);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });
});

describe('billing-flow: claim status machine', () => {
  it('maps every claim action to its target status', () => {
    expect(assertClaimAction({ status: 'DRAFT' }, 'submit')).toBe('SUBMITTED');
    expect(assertClaimAction({ status: 'SUBMITTED' }, 'approve')).toBe('APPROVED');
    expect(assertClaimAction({ status: 'SUBMITTED' }, 'partial_approve')).toBe('PARTIALLY_APPROVED');
    expect(assertClaimAction({ status: 'SUBMITTED' }, 'deny')).toBe('DENIED');
    expect(assertClaimAction({ status: 'APPROVED' }, 'pay')).toBe('PAID');
  });

  it('rejects transitions from the wrong current status', () => {
    for (const [status, action] of [
      ['APPROVED', 'submit'],
      ['DRAFT', 'approve'],
      ['PAID', 'deny'],
      ['DENIED', 'approve'],
    ] as const) {
      try {
        assertClaimAction({ status }, action);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });
});