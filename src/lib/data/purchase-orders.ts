import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Procurement reads (F6 — purchase orders, suppliers).
 *
 * `GET /purchase-orders` is the GAP-020 mis-typing in its purest form: the
 * export fastens the *request* DTO (`ListPurchaseOrdersQueryDto`) onto the 200
 * while `PurchaseOrdersService.list` returns `pageOf(rows.map(serializePo), …)`
 * — an array of serialized orders under the unwrapped `data`, with the totals in
 * the sibling `meta`. `GET /suppliers` drifts the same way (`ListSuppliersQueryDto`
 * over a `pageOf(...)` of supplier rows), so both reads ride the raw-fetch
 * precedent and validate every row structurally. A body that drifts again fails
 * loudly rather than rendering as an empty list.
 *
 * The projected fields are the ones the list shows. Money is deliberately left
 * out: `unitCost` is a Prisma `Decimal` that arrives as a string, and this
 * screen reports coverage (lines, units ordered against units received), not
 * value — see ADR-029 for why a decimal is never coerced to a float.
 */

/** The eight states `PurchaseOrderStatus` can hold, from `prisma/schema.prisma`. */
export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** One line of a purchase order: what was ordered against what has arrived. */
export interface PurchaseOrderLine {
  readonly medicationId: string;
  readonly quantityOrdered: number;
  readonly quantityReceived: number;
}

export interface PurchaseOrderRow {
  readonly id: string;
  readonly poNumber: string;
  readonly supplierId: string;
  readonly branchId: string;
  readonly status: PurchaseOrderStatus;
  readonly expectedAt: string | null;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly receivedAt: string | null;
  readonly closedAt: string | null;
  readonly notes: string | null;
  readonly version: number;
  readonly items: readonly PurchaseOrderLine[];
}

export interface PurchaseOrderPage {
  readonly rows: readonly PurchaseOrderRow[];
  readonly total: number;
}

export type PurchaseOrderCallError = EnvelopeCallError;

function isStatus(value: unknown): value is PurchaseOrderStatus {
  return (
    typeof value === 'string' &&
    (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value)
  );
}

/** Reads one serialized order line; returns null when the line is unusable. */
function readLine(value: unknown): PurchaseOrderLine | null {
  if (!isRecord(value)) return null;
  if (typeof value.medicationId !== 'string') return null;
  if (typeof value.quantityOrdered !== 'number') return null;
  if (typeof value.quantityReceived !== 'number') return null;
  return {
    medicationId: value.medicationId,
    quantityOrdered: value.quantityOrdered,
    quantityReceived: value.quantityReceived,
  };
}

/** Reads one serialized purchase order; returns null when the row is unusable. */
export function readPurchaseOrder(value: unknown): PurchaseOrderRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.poNumber !== 'string' || value.poNumber.length === 0) return null;
  if (typeof value.supplierId !== 'string' || value.supplierId.length === 0) return null;
  if (typeof value.branchId !== 'string' || value.branchId.length === 0) return null;
  if (!isStatus(value.status)) return null;
  if (typeof value.version !== 'number') return null;
  if (!Array.isArray(value.items)) return null;
  const items = value.items.map(readLine);
  if (items.some((line) => line === null)) return null;
  return {
    id: value.id,
    poNumber: value.poNumber,
    supplierId: value.supplierId,
    branchId: value.branchId,
    status: value.status,
    expectedAt: nullableString(value.expectedAt),
    submittedAt: nullableString(value.submittedAt),
    approvedAt: nullableString(value.approvedAt),
    receivedAt: nullableString(value.receivedAt),
    closedAt: nullableString(value.closedAt),
    notes: nullableString(value.notes),
    version: value.version,
    items: items as readonly PurchaseOrderLine[],
  };
}

/** Reads the order page from the unwrapped `data` plus the sibling `meta`. */
export function extractPurchaseOrderPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: PurchaseOrderPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readPurchaseOrder);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly PurchaseOrderRow[], total: pageTotal(meta, rows.length) },
  };
}

export interface PurchaseOrderQuery {
  readonly status?: PurchaseOrderStatus;
  readonly page?: number;
  readonly limit?: number;
}

/** Raw read against `GET /purchase-orders?…` (GAP-020: the 200 is the query DTO). */
export async function fetchPurchaseOrders(
  query: PurchaseOrderQuery = {},
  signal?: AbortSignal,
): Promise<PurchaseOrderPage> {
  const suffix = queryString({
    status: query.status,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/purchase-orders${suffix}`;
  return readEnvelope<PurchaseOrderPage>(
    url,
    (data, meta) => {
      const page = extractPurchaseOrderPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Shape every supplier call rejects with, matching the query error contract. */
export type SupplierCallError = EnvelopeCallError;

/** A supplier as the list reports it — an id and a name are all the screens need. */
export interface SupplierRow {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface SupplierPage {
  readonly rows: readonly SupplierRow[];
  readonly total: number;
}

/** Reads one serialized supplier; returns null when the row is unusable. */
export function readSupplier(value: unknown): SupplierRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.name !== 'string' || value.name.length === 0) return null;
  if (typeof value.isActive !== 'boolean') return null;
  return { id: value.id, name: value.name, isActive: value.isActive };
}

/** Reads the supplier page from the unwrapped `data` plus the sibling `meta`. */
export function extractSupplierPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: SupplierPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readSupplier);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly SupplierRow[], total: pageTotal(meta, rows.length) },
  };
}

export interface SupplierQuery {
  readonly page?: number;
  readonly limit?: number;
}

/**
 * Raw read against `GET /suppliers?…`. The export types the 200 as
 * `ListSuppliersQueryDto` (the query, again), so the name lookup the purchase
 * order list needs is validated structurally like every other list read.
 */
export async function fetchSuppliers(
  query: SupplierQuery = {},
  signal?: AbortSignal,
): Promise<SupplierPage> {
  const suffix = queryString({
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/suppliers${suffix}`;
  return readEnvelope<SupplierPage>(
    url,
    (data, meta) => {
      const page = extractSupplierPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}
