import { describe, expect, it } from 'vitest';

import {
  extractInvoicePage,
  extractInvoiceRecord,
  extractPaymentRecord,
  readInvoice,
  readPayment,
  toCreateInvoiceBody,
} from '@/lib/data/billing';

/**
 * F7 billing data layer.
 *
 * `GET /invoices` types the 200 as the request DTO and `GET /invoices/{id}` types
 * the bare entity while the service answers `{ invoice }` (GAP-020 family); the
 * payment writes answer `{ payment }` while the export types the bare entity.
 * Every money field is a decimal string (ADR-029) and is validated as a string
 * only — never parsed here.
 */

const invoice = {
  id: 'inv_example_8001',
  organizationId: 'org_example_1',
  branchId: 'br_example_0001',
  patientId: 'pat_example_0001',
  invoiceNumber: 'INV-2026-000001',
  status: 'ISSUED',
  visitId: 'visit_example_1',
  encounterId: null,
  subtotal: '1500.00',
  discountAmount: '0.00',
  taxAmount: '0.00',
  total: '1500.00',
  balanceDue: '1500.00',
  dueAt: null,
  notes: null,
  issuedAt: '2026-10-01T09:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  refundedAt: null,
  refundReason: null,
  version: 2,
  items: [
    {
      id: 'item_example_1',
      organizationId: 'org_example_1',
      invoiceId: 'inv_example_8001',
      description: 'EXAMPLE Consultation',
      quantity: 1,
      unitPrice: '1500.00',
      lineTotal: '1500.00',
      referenceType: null,
      referenceId: null,
    },
  ],
  payments: [
    {
      id: 'pay_example_1',
      receiptNumber: 'RCP-0001',
      amount: '500.00',
      method: 'CASH',
      status: 'COMPLETED',
      recordedAt: '2026-10-02T10:00:00.000Z',
    },
  ],
};

describe('readInvoice', () => {
  it('reads money as decimal strings and keeps items and payments', () => {
    const parsed = readInvoice(invoice);
    expect(parsed?.total).toBe('1500.00');
    expect(typeof parsed?.balanceDue).toBe('string');
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.payments[0]?.receiptNumber).toBe('RCP-0001');
  });

  it('defaults an absent payments array to empty (the list omits payments)', () => {
    const { payments: _payments, ...withoutPayments } = invoice;
    const parsed = readInvoice({ ...withoutPayments, status: 'DRAFT' });
    expect(parsed?.payments).toEqual([]);
  });

  it('fails closed on a drifted status or a non-string amount', () => {
    expect(readInvoice({ ...invoice, status: 'SETTLED' })).toBeNull();
    expect(readInvoice({ ...invoice, total: 1500 })).toBeNull();
    expect(readInvoice({ ...invoice, balanceDue: null })).toBeNull();
    expect(readInvoice({ ...invoice, id: undefined })).toBeNull();
    expect(readInvoice(null)).toBeNull();
  });

  it('fails closed when a line item drifts', () => {
    expect(
      readInvoice({ ...invoice, items: [{ ...invoice.items[0], unitPrice: 1500 }] }),
    ).toBeNull();
    expect(readInvoice({ ...invoice, items: [{ id: 'x' }] })).toBeNull();
  });
});

describe('extractInvoicePage', () => {
  it('reads the unwrapped rows and total from the sibling meta', () => {
    const parsed = extractInvoicePage([invoice], { total: 1, page: 1, limit: 20 });
    expect(parsed.ok && parsed.page.rows[0]?.invoiceNumber).toBe('INV-2026-000001');
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('accepts an empty list and fails closed on a broken body', () => {
    expect(extractInvoicePage([], undefined).ok && true).toBe(true);
    expect(extractInvoicePage({ items: [] }, undefined)).toEqual({ ok: false });
    expect(extractInvoicePage([{}], undefined)).toEqual({ ok: false });
    expect(extractInvoicePage(null, undefined)).toEqual({ ok: false });
  });
});

describe('extractInvoiceRecord', () => {
  it('unwraps the { invoice } body', () => {
    const parsed = extractInvoiceRecord({ invoice });
    expect(parsed.ok && parsed.invoice.id).toBe('inv_example_8001');
  });

  it('fails closed on a bare invoice or a broken body', () => {
    expect(extractInvoiceRecord(invoice)).toEqual({ ok: false });
    expect(extractInvoiceRecord({ invoice: {} })).toEqual({ ok: false });
    expect(extractInvoiceRecord(null)).toEqual({ ok: false });
  });
});

const payment = {
  id: 'pay_example_1',
  organizationId: 'org_example_1',
  invoiceId: 'inv_example_8001',
  patientId: 'pat_example_0001',
  receiptNumber: 'RCP-0001',
  amount: '500.00',
  method: 'CASH',
  status: 'COMPLETED',
  externalReference: null,
  note: null,
  recordedById: 'usr_example_1',
  recordedAt: '2026-10-01T10:00:00.000Z',
  refundedAt: null,
  refundReason: null,
};

describe('readPayment', () => {
  it('reads a full payment, keeping the amount a string', () => {
    const parsed = readPayment(payment);
    expect(parsed?.amount).toBe('500.00');
    expect(parsed?.method).toBe('CASH');
  });

  it('fails closed when a required field drifts', () => {
    expect(readPayment({ ...payment, amount: 500 })).toBeNull();
    expect(readPayment({ ...payment, invoiceId: undefined })).toBeNull();
    expect(readPayment(null)).toBeNull();
  });
});

describe('extractPaymentRecord', () => {
  it('unwraps the { payment } body', () => {
    const parsed = extractPaymentRecord({ payment });
    expect(parsed.ok && parsed.payment.receiptNumber).toBe('RCP-0001');
  });

  it('fails closed on a bare payment or a broken body', () => {
    expect(extractPaymentRecord(payment)).toEqual({ ok: false });
    expect(extractPaymentRecord(null)).toEqual({ ok: false });
  });
});

describe('toCreateInvoiceBody', () => {
  it('keeps the required branch and patient and the priced lines', () => {
    const body = toCreateInvoiceBody({
      branchId: 'br_example_0001',
      patientId: 'pat_example_0001',
      items: [{ description: 'EXAMPLE Consultation', quantity: 2, unitPrice: '1500.00' }],
    });
    expect(body.branchId).toBe('br_example_0001');
    expect(body.patientId).toBe('pat_example_0001');
    expect(body.items).toEqual([
      { description: 'EXAMPLE Consultation', quantity: 2, unitPrice: '1500.00' },
    ]);
  });

  it('drops blank optional fields rather than sending empty strings', () => {
    const body = toCreateInvoiceBody({
      branchId: 'br_example_0001',
      patientId: 'pat_example_0001',
      notes: '',
      dueAt: '',
      items: [{ description: 'EXAMPLE X-ray', quantity: 1, unitPrice: '1200.00', referenceId: '' }],
    });
    expect(body.notes).toBeUndefined();
    expect(body.dueAt).toBeUndefined();
    expect((body.items as Record<string, unknown>[])[0]?.referenceId).toBeUndefined();
  });
});
