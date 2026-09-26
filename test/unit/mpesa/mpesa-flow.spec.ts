import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertResolutionAllowed,
  classifyPayment,
} from '../../../src/modules/mpesa/domain/mpesa-flow';

function dec(n: string | number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function ctrx(
  checkoutRequestId: string,
  amount: string | number,
  kind: 'SUCCEEDED' | 'MISMATCHED' | 'FAILED' = 'SUCCEEDED',
) {
  return { checkoutRequestId, amount: dec(amount), kind };
}

function pay(
  id: string,
  externalReference: string | null,
  amount: string | number,
  method = 'MPESA',
) {
  return { id, externalReference, amount: dec(amount), method };
}

describe('mpesa-flow: classifyPayment', () => {
  it('MATCHED: provider tx + MPESA payment with the same amount', () => {
    const drafts = classifyPayment([ctrx('C1', 500)], [pay('p1', 'C1', 500)]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      reference: 'C1',
      status: 'MATCHED',
      paymentId: 'p1',
    });
  });

  it('UNMATCHED: provider charged but the books have no payment', () => {
    const drafts = classifyPayment([ctrx('C1', 500)], []);
    expect(drafts[0]!.status).toBe('UNMATCHED');
    expect(drafts[0]!.providerAmount?.toString()).toBe('500');
    expect(drafts[0]!.expectedAmount).toBeNull();
  });

  it('UNMATCHED: a payment exists but the provider has no record of it', () => {
    const drafts = classifyPayment([], [pay('p1', 'C1', 500)]);
    expect(drafts[0]!.status).toBe('UNMATCHED');
    expect(drafts[0]!.paymentId).toBe('p1');
  });

  it('UNMATCHED (with explanation) when a mismatched callback moved no book row', () => {
    const drafts = classifyPayment([ctrx('C1', 600, 'MISMATCHED')], []);
    expect(drafts[0]!.status).toBe('UNMATCHED');
    expect(drafts[0]!.notes).toMatch(/differed from the STK request/);
  });

  it('DUPLICATE: more than one provider charge for one reference', () => {
    const drafts = classifyPayment([ctrx('C1', 500), ctrx('C1', 500)], [pay('p1', 'C1', 500)]);
    expect(drafts[0]!.status).toBe('DUPLICATE');
    expect(drafts[0]!.notes).toMatch(/2 transactions/);
  });

  it('AMOUNT_MISMATCH: booked amount differs from the provider amount', () => {
    const drafts = classifyPayment([ctrx('C1', 550)], [pay('p1', 'C1', 500)]);
    expect(drafts[0]!.status).toBe('AMOUNT_MISMATCH');
    expect(drafts[0]!.expectedAmount?.toString()).toBe('500');
    expect(drafts[0]!.providerAmount?.toString()).toBe('550');
  });

  it('REFERENCE_MISMATCH: the reference belongs to a non-MPESA payment', () => {
    const drafts = classifyPayment([ctrx('C1', 500)], [pay('p1', 'C1', 500, 'CARD')]);
    expect(drafts[0]!.status).toBe('REFERENCE_MISMATCH');
  });

  it('ignores FAILED provider pushes (no money moved)', () => {
    const drafts = classifyPayment([ctrx('C1', 500, 'FAILED')], []);
    expect(drafts).toHaveLength(0);
  });

  it('produces one draft per distinct reference in the union', () => {
    const drafts = classifyPayment(
      [ctrx('C1', 500), ctrx('C2', 250)],
      [pay('p1', 'C1', 500), pay('p2', 'C3', 100)],
    );
    expect(drafts.map((d) => d.reference).sort()).toEqual(['C1', 'C2', 'C3']);
  });
});

describe('mpesa-flow: assertResolutionAllowed', () => {
  it('accepts every documented resolution', () => {
    for (const r of ['VERIFIED', 'CORRECTED', 'PAID_OUT_OF_BAND', 'DUPLICATE_REFUNDED', 'WRITTEN_OFF', 'ESCALATED']) {
      expect(() => assertResolutionAllowed(r)).not.toThrow();
    }
  });

  it('rejects unknown resolutions', () => {
    let code = '';
    try {
      assertResolutionAllowed('RESOLVED');
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});