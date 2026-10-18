import { describe, expect, it } from 'vitest';

import {
  extractPurchaseOrderPage,
  extractSupplierPage,
  readPurchaseOrder,
  readSupplier,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderRow,
} from '@/lib/data/purchase-orders';

/**
 * F6 procurement data layer.
 *
 * Both list reads are mis-typed in the export (the query DTO is fastened onto
 * the 200 while the service answers `pageOf(...)`), so both are validated
 * structurally. Each reader fails closed on drift rather than rendering an
 * empty list that a pharmacist would read as "no orders".
 */

const order: PurchaseOrderRow = {
  id: 'po_example_3001',
  poNumber: 'PO-2026-0001',
  supplierId: 'sup_example_4001',
  branchId: 'br_example_0001',
  status: 'ORDERED',
  expectedAt: '2026-03-02T09:00:00.000Z',
  submittedAt: '2026-02-20T11:15:00.000Z',
  approvedAt: '2026-02-21T08:05:00.000Z',
  receivedAt: null,
  closedAt: null,
  notes: 'EXAMPLE monthly restock.',
  version: 3,
  items: [
    { medicationId: 'med_example_7101', quantityOrdered: 40, quantityReceived: 0 },
    { medicationId: 'med_example_7103', quantityOrdered: 12, quantityReceived: 12 },
  ],
};

describe('readPurchaseOrder', () => {
  it('reads a full projection, keeping coverage and the workflow timestamps', () => {
    expect(readPurchaseOrder(order)).toEqual(order);
  });

  it('tolerates the nullable timestamps and notes', () => {
    const parsed = readPurchaseOrder({
      ...order,
      expectedAt: null,
      submittedAt: null,
      approvedAt: null,
      receivedAt: null,
      closedAt: null,
      notes: null,
      items: [],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.items).toEqual([]);
    expect(parsed?.expectedAt).toBeNull();
  });

  it('fails closed on a status the workflow does not define', () => {
    expect(readPurchaseOrder({ ...order, status: 'IN_TRANSIT' })).toBeNull();
  });

  it('fails closed when an identity field or a line drifts', () => {
    expect(readPurchaseOrder({ ...order, poNumber: 41 })).toBeNull();
    expect(readPurchaseOrder({ ...order, version: '3' })).toBeNull();
    expect(
      readPurchaseOrder({ ...order, items: [{ medicationId: 'med_example_7101' }] }),
    ).toBeNull();
    expect(readPurchaseOrder('po_example_3001')).toBeNull();
  });

  it('defines exactly the eight states the schema declares', () => {
    expect([...PURCHASE_ORDER_STATUSES]).toEqual([
      'DRAFT',
      'SUBMITTED',
      'APPROVED',
      'ORDERED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CLOSED',
      'CANCELLED',
    ]);
  });
});

describe('extractPurchaseOrderPage', () => {
  it('reads rows out of the unwrapped data and the total out of meta', () => {
    const page = extractPurchaseOrderPage([order], {
      page: 1,
      limit: 25,
      total: 61,
      totalPages: 3,
    });
    expect(page).toEqual({ ok: true, page: { rows: [order], total: 61 } });
  });

  it('accepts an empty page and falls back to the row count without meta', () => {
    expect(extractPurchaseOrderPage([], undefined)).toEqual({
      ok: true,
      page: { rows: [], total: 0 },
    });
    expect(extractPurchaseOrderPage([order], undefined)).toEqual({
      ok: true,
      page: { rows: [order], total: 1 },
    });
  });

  it('fails closed when the body is not the page the service returns', () => {
    expect(extractPurchaseOrderPage({ purchaseOrders: [order] }, {}).ok).toBe(false);
    expect(extractPurchaseOrderPage(null, {}).ok).toBe(false);
    expect(extractPurchaseOrderPage([order, { id: 'po_broken' }], {}).ok).toBe(false);
  });
});

describe('readSupplier', () => {
  it('reads an id, a name and the active flag', () => {
    expect(readSupplier({ id: 'sup_example_4001', name: 'EXAMPLE Pharma Ltd', isActive: true }))
      .toEqual({ id: 'sup_example_4001', name: 'EXAMPLE Pharma Ltd', isActive: true });
  });

  it('fails closed when a field drifts', () => {
    expect(readSupplier({ id: 'sup_example_4001', name: 'EXAMPLE Pharma Ltd' })).toBeNull();
    expect(readSupplier({ id: 1, name: 'EXAMPLE Pharma Ltd', isActive: true })).toBeNull();
    expect(readSupplier({ id: 'sup_example_4001', name: '', isActive: true })).toBeNull();
  });
});

describe('extractSupplierPage', () => {
  it('reads rows and the total, and fails closed on drift', () => {
    const supplier = { id: 'sup_example_4001', name: 'EXAMPLE Pharma Ltd', isActive: true };
    expect(extractSupplierPage([supplier], { total: 4 })).toEqual({
      ok: true,
      page: { rows: [supplier], total: 4 },
    });
    expect(extractSupplierPage({ suppliers: [supplier] }, {}).ok).toBe(false);
    expect(extractSupplierPage([supplier, { id: 'sup_broken' }], {}).ok).toBe(false);
  });
});
