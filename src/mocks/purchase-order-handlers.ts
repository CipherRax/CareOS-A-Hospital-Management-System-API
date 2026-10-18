import { http, HttpResponse } from 'msw';

import {
  PROCUREMENT_SUPPLIERS,
  PURCHASE_ORDERS,
  type PurchaseOrderFixture,
  type PurchaseOrderItemFixture,
} from '@/mocks/fixtures/purchase-order-registry';
import { apiError, apiPage, apiOk, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F6 procurement handlers (purchase-order worklist and its three writes).
 *
 * `GET /purchase-orders` is served as the service answers it — a page of
 * serialized orders under the unwrapped `data`, with the totals in the sibling
 * `meta` — not as the export types it (the *query* DTO, GAP-020). Every single
 * order read and write answers the `{ purchaseOrder }` envelope the service uses
 * while the export types the bare entity, so the client validates each body
 * structurally.
 *
 * State is a deep clone of the fixture registry, mutable for the length of the
 * mock session: raising, submitting, approving, ordering, receiving and closing
 * all move the same records the worklist reads back. The guards mirror
 * `domain/po-flow.ts` (submit DRAFT→SUBMITTED, approve SUBMITTED→APPROVED, order
 * APPROVED→ORDERED, receive ORDERED|PARTIALLY_RECEIVED→RECEIVED|PARTIALLY_RECEIVED,
 * close RECEIVED→CLOSED) and the receive ceiling mirrors the service: more than
 * the outstanding quantity is a `VALIDATION_ERROR`.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface MutablePo extends Mutable<PurchaseOrderFixture> {
  items: Mutable<PurchaseOrderItemFixture>[];
}

function clone(): MutablePo[] {
  return PURCHASE_ORDERS.map((order) => ({
    ...order,
    items: order.items.map((item) => ({ ...item })),
  }));
}

const orders = clone();
let poSeq = 3007;
let poNumberSeq = 7;

const ALLOWED_FROM: Record<string, string> = {
  submit: 'DRAFT',
  approve: 'SUBMITTED',
  order: 'APPROVED',
  close: 'RECEIVED',
};

const TARGET_STATUS: Record<string, string> = {
  submit: 'SUBMITTED',
  approve: 'APPROVED',
  order: 'ORDERED',
  close: 'CLOSED',
};

function findOrder(id: string): MutablePo | undefined {
  return orders.find((order) => order.id === id);
}

function notFound() {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Purchase order not found'), {
    status: 404,
  });
}

function workflowConflict(message: string) {
  return HttpResponse.json(apiError('INVALID_WORKFLOW_TRANSITION', message), { status: 409 });
}

function validationError(message: string) {
  return HttpResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function purchaseOrderHandlers() {
  return [
    http.get('*/api/v1/purchase-orders', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '25') || 25));

      const filtered = orders.filter((order) => !status || order.status === status);
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/purchase-orders/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(String(params.id));
      if (!order) return notFound();
      return HttpResponse.json(apiOk({ purchaseOrder: order }));
    }),

    http.get('*/api/v1/suppliers', async () => {
      await delay(MOCK_LATENCY_MS);
      return HttpResponse.json(apiPage(PROCUREMENT_SUPPLIERS));
    }),

    http.post('*/api/v1/purchase-orders', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      if (!body) return validationError('A purchase order body is required.');
      const supplierId = stringField(body.supplierId);
      const branchId = stringField(body.branchId);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!supplierId || !PROCUREMENT_SUPPLIERS.some((supplier) => supplier.id === supplierId)) {
        return notFound();
      }
      if (!branchId) return notFound();
      if (items.length === 0) {
        return validationError('A purchase order needs at least one item.');
      }
      const lines: Mutable<PurchaseOrderItemFixture>[] = [];
      const seen = new Set<string>();
      for (const raw of items) {
        if (typeof raw !== 'object' || raw === null) {
          return validationError('An item is malformed.');
        }
        const item = raw as Record<string, unknown>;
        const medicationId = stringField(item.medicationId);
        const quantityOrdered = item.quantityOrdered;
        if (!medicationId) return validationError('An item is missing its medication.');
        if (typeof quantityOrdered !== 'number' || !Number.isInteger(quantityOrdered) || quantityOrdered <= 0) {
          return validationError('An item quantity must be a whole number greater than zero.');
        }
        if (seen.has(medicationId)) {
          return validationError('Each medication can appear on only one line.');
        }
        seen.add(medicationId);
        lines.push({
          id: `poi_example_${poSeq}${lines.length + 1}`,
          medicationId,
          quantityOrdered,
          quantityReceived: 0,
          unitCost: typeof item.unitCost === 'number' ? item.unitCost.toFixed(2) : null,
        });
      }

      poSeq += 1;
      const order: MutablePo = {
        id: `po_example_${poSeq}`,
        organizationId: 'org_example_1',
        branchId,
        supplierId,
        poNumber: `PO-2026-${String(poNumberSeq).padStart(6, '0')}`,
        status: 'DRAFT',
        expectedAt: stringField(body.expectedAt),
        notes: stringField(body.notes),
        createdById: 'usr_example_9001',
        submittedById: null,
        approvedById: null,
        submittedAt: null,
        approvedAt: null,
        receivedAt: null,
        closedAt: null,
        version: 1,
        items: lines,
      };
      orders.unshift(order);
      poNumberSeq += 1;
      return HttpResponse.json(apiOk({ purchaseOrder: order }), { status: 201 });
    }),

    http.post('*/api/v1/purchase-orders/:id/action', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(String(params.id));
      if (!order) return notFound();
      const body = await readJson(request);
      const action = body ? stringField(body.action) : null;
      if (!action || !(action in ALLOWED_FROM)) {
        return validationError('Unknown purchase order action.');
      }
      if (order.status !== ALLOWED_FROM[action]) {
        return workflowConflict(`A ${order.status} purchase order cannot be ${action}ed.`);
      }
      const target = TARGET_STATUS[action];
      if (target === undefined) return validationError('Unknown purchase order action.');
      const now = new Date().toISOString();
      order.status = target;
      order.version += 1;
      if (action === 'submit') {
        order.submittedAt = now;
        order.submittedById = 'usr_example_9001';
      }
      if (action === 'approve') {
        order.approvedAt = now;
        order.approvedById = 'usr_example_9001';
      }
      if (action === 'close') {
        order.closedAt = now;
      }
      return HttpResponse.json(apiOk({ purchaseOrder: order }), { status: 201 });
    }),

    http.post('*/api/v1/purchase-orders/:id/receive', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(String(params.id));
      if (!order) return notFound();
      if (order.status !== 'ORDERED' && order.status !== 'PARTIALLY_RECEIVED') {
        return workflowConflict(`A ${order.status} purchase order cannot be received.`);
      }
      const body = await readJson(request);
      const lines = body && Array.isArray(body.lines) ? body.lines : [];
      if (lines.length === 0) return validationError('At least one received line is required.');

      const received = new Map<string, { quantity: number; batchNumber: string }>();
      for (const raw of lines) {
        if (typeof raw !== 'object' || raw === null) {
          return validationError('A received line is malformed.');
        }
        const line = raw as Record<string, unknown>;
        const medicationId = stringField(line.medicationId);
        const batchNumber = stringField(line.batchNumber);
        const quantity = line.quantity;
        if (!medicationId || !batchNumber) {
          return validationError('A received line needs a medication and a batch number.');
        }
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
          return validationError('A received quantity must be a whole number greater than zero.');
        }
        received.set(medicationId, { quantity, batchNumber });
      }

      for (const item of order.items) {
        const line = received.get(item.medicationId);
        if (!line) continue;
        const outstanding = item.quantityOrdered - item.quantityReceived;
        if (line.quantity > outstanding) {
          return validationError(
            `Receiving ${line.quantity} units of ${item.medicationId} exceeds the outstanding ${outstanding}.`,
          );
        }
      }

      for (const item of order.items) {
        const line = received.get(item.medicationId);
        if (!line) continue;
        item.quantityReceived += line.quantity;
      }

      const fullyReceived = order.items.every((item) => item.quantityReceived >= item.quantityOrdered);
      order.status = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      if (fullyReceived) order.receivedAt = new Date().toISOString();
      order.version += 1;
      return HttpResponse.json(apiOk({ purchaseOrder: order }), { status: 201 });
    }),
  ];
}
