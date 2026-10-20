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
 * Billing & invoicing (F7 — invoices desk and payments).
 *
 * Money is a **decimal string** everywhere on the wire (ADR-029: `Decimal(12,2)`,
 * never integer cents), so this layer only ever validates that a field is a
 * string — it never parses or computes an amount. Display goes through
 * `MoneyText`; any arithmetic would need a decimal library.
 *
 * `GET /invoices` types the 200 as the request DTO and `GET /invoices/{id}` types
 * the bare entity while the service answers `{ invoice }` (GAP-020 family), so
 * both ride the raw-fetch path and are validated structurally. The list omits
 * payments (they are only serialized on the detail read), so `payments` defaults
 * to an empty array.
 */

export const INVOICE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'REFUNDED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'MOBILE_MONEY',
  'BANK_TRANSFER',
  'CHEQUE',
  'INSURANCE',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface InvoiceItemRow {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly referenceType: string | null;
  readonly referenceId: string | null;
}

/** The thin payment summary embedded in an invoice detail read. */
export interface InvoicePaymentRow {
  readonly id: string;
  readonly receiptNumber: string;
  readonly amount: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly recordedAt: string | null;
}

export interface InvoiceRow {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly invoiceNumber: string;
  readonly status: InvoiceStatus;
  readonly visitId: string | null;
  readonly encounterId: string | null;
  readonly subtotal: string;
  readonly discountAmount: string;
  readonly taxAmount: string;
  readonly total: string;
  readonly balanceDue: string;
  readonly dueAt: string | null;
  readonly notes: string | null;
  readonly issuedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly refundedAt: string | null;
  readonly refundReason: string | null;
  readonly version: number;
  readonly items: readonly InvoiceItemRow[];
  readonly payments: readonly InvoicePaymentRow[];
}

export interface InvoicePage {
  readonly rows: readonly InvoiceRow[];
  readonly total: number;
}

export interface InvoiceQuery {
  readonly branchId?: string;
  readonly patientId?: string;
  readonly status?: InvoiceStatus;
  readonly page?: number;
  readonly limit?: number;
}

/**
 * One requested invoice line. `billableItemId`/`medicationId` name a catalogue
 * row the server resolves and prices; when neither is given the line must carry
 * its own `description` and `unitPrice` (`CreateInvoiceDto`).
 */
export interface CreateInvoiceItemInput {
  readonly billableItemId?: string;
  readonly medicationId?: string;
  readonly description?: string;
  readonly quantity: number;
  readonly unitPrice?: string;
  readonly referenceType?: string;
  readonly referenceId?: string;
}

/**
 * Body of `POST /invoices` (`CreateInvoiceDto`). `branchId` and `patientId` are
 * required; money stays a decimal string (ADR-029).
 */
export interface CreateInvoiceInput {
  readonly branchId: string;
  readonly patientId: string;
  readonly visitId?: string;
  readonly encounterId?: string;
  readonly discountAmount?: string;
  readonly taxAmount?: string;
  readonly dueAt?: string;
  readonly notes?: string;
  readonly items: readonly CreateInvoiceItemInput[];
}

/** A full payment record (`GET /payments/{id}`, payment writes). */
export interface PaymentRow {
  readonly id: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly receiptNumber: string;
  readonly amount: string;
  readonly method: PaymentMethod;
  readonly status: string;
  readonly externalReference: string | null;
  readonly note: string | null;
  readonly recordedAt: string | null;
  readonly refundedAt: string | null;
  readonly refundReason: string | null;
}

export type BillingCallError = EnvelopeCallError;

/** Reads a money field; a non-string is drift, so it fails closed. */
function money(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readInvoiceItem(value: unknown): InvoiceItemRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.description !== 'string') return null;
  if (typeof value.quantity !== 'number') return null;
  if (typeof value.unitPrice !== 'string' || typeof value.lineTotal !== 'string') return null;
  return {
    id: value.id,
    description: value.description,
    quantity: value.quantity,
    unitPrice: value.unitPrice,
    lineTotal: value.lineTotal,
    referenceType: nullableString(value.referenceType),
    referenceId: nullableString(value.referenceId),
  };
}

function readInvoicePayment(value: unknown): InvoicePaymentRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.receiptNumber !== 'string') return null;
  if (typeof value.amount !== 'string') return null;
  if (typeof value.method !== 'string' || typeof value.status !== 'string') return null;
  return {
    id: value.id,
    receiptNumber: value.receiptNumber,
    amount: value.amount,
    method: value.method as PaymentRow['method'],
    status: value.status as InvoicePaymentRow['status'],
    recordedAt: nullableString(value.recordedAt),
  };
}

/** Reads one serialized invoice; returns null when a required field has drifted. */
export function readInvoice(value: unknown): InvoiceRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.invoiceNumber !== 'string') return null;
  if (typeof value.patientId !== 'string' || typeof value.branchId !== 'string') return null;
  if (
    typeof value.status !== 'string' ||
    !INVOICE_STATUSES.includes(value.status as InvoiceStatus)
  ) {
    return null;
  }
  const subtotal = money(value.subtotal);
  const total = money(value.total);
  const balanceDue = money(value.balanceDue);
  if (subtotal === null || total === null || balanceDue === null) return null;

  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items = rawItems.map(readInvoiceItem);
  if (items.some((item) => item === null)) return null;
  const rawPayments = Array.isArray(value.payments) ? value.payments : [];
  const payments = rawPayments.map(readInvoicePayment);
  if (payments.some((payment) => payment === null)) return null;

  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    branchId: value.branchId,
    patientId: value.patientId,
    invoiceNumber: value.invoiceNumber,
    status: value.status as InvoiceStatus,
    visitId: nullableString(value.visitId),
    encounterId: nullableString(value.encounterId),
    subtotal,
    discountAmount: money(value.discountAmount) ?? '0',
    taxAmount: money(value.taxAmount) ?? '0',
    total,
    balanceDue,
    dueAt: nullableString(value.dueAt),
    notes: nullableString(value.notes),
    issuedAt: nullableString(value.issuedAt),
    cancelledAt: nullableString(value.cancelledAt),
    cancelReason: nullableString(value.cancelReason),
    refundedAt: nullableString(value.refundedAt),
    refundReason: nullableString(value.refundReason),
    version: typeof value.version === 'number' ? value.version : 0,
    items: items as readonly InvoiceItemRow[],
    payments: payments as readonly InvoicePaymentRow[],
  };
}

/** Reads the invoice page from the unwrapped `data` plus the sibling `meta`. */
export function extractInvoicePage(
  data: unknown,
  meta: unknown,
): { ok: true; page: InvoicePage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readInvoice);
  if (rows.some((row) => row === null)) return { ok: false };
  return { ok: true, page: { rows: rows as readonly InvoiceRow[], total: pageTotal(meta, rows.length) } };
}

/** Reads a single-invoice body: the service answers `{ invoice }`. */
export function extractInvoiceRecord(
  payload: unknown,
): { ok: true; invoice: InvoiceRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const invoice = readInvoice(payload.invoice);
  return invoice ? { ok: true, invoice } : { ok: false };
}

/** Reads one full payment record; returns null when a required field has drifted. */
export function readPayment(value: unknown): PaymentRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.invoiceId !== 'string') return null;
  if (typeof value.patientId !== 'string' || typeof value.receiptNumber !== 'string') return null;
  const amount = money(value.amount);
  if (amount === null || typeof value.method !== 'string' || typeof value.status !== 'string') {
    return null;
  }
  return {
    id: value.id,
    invoiceId: value.invoiceId,
    patientId: value.patientId,
    receiptNumber: value.receiptNumber,
    amount,
    method: value.method as PaymentRow['method'],
    status: value.status,
    externalReference: nullableString(value.externalReference),
    note: nullableString(value.note),
    recordedAt: nullableString(value.recordedAt),
    refundedAt: nullableString(value.refundedAt),
    refundReason: nullableString(value.refundReason),
  };
}

/** Reads a single-payment body: the service answers `{ payment }`. */
export function extractPaymentRecord(
  payload: unknown,
): { ok: true; payment: PaymentRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const payment = readPayment(payload.payment);
  return payment ? { ok: true, payment } : { ok: false };
}

/** Raw read against `GET /invoices?{filters}` (GAP-020: the 200 is the query DTO). */
export async function fetchInvoices(
  query: InvoiceQuery = {},
  signal?: AbortSignal,
): Promise<InvoicePage> {
  const suffix = queryString({
    branchId: query.branchId,
    patientId: query.patientId,
    status: query.status,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/invoices${suffix}`;
  return readEnvelope<InvoicePage>(
    url,
    (data, meta) => {
      const page = extractInvoicePage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /invoices/{id}` (the service answers `{ invoice }`). */
export async function fetchInvoice(id: string, signal?: AbortSignal): Promise<InvoiceRow> {
  const url = `${publicEnv.apiBasePath}/invoices/${encodeURIComponent(id)}`;
  return readEnvelope<InvoiceRow>(
    url,
    (data) => {
      const parsed = extractInvoiceRecord(data);
      return parsed.ok ? { ok: true, value: parsed.invoice } : { ok: false };
    },
    signal,
  );
}

/**
 * Serializes a `CreateInvoiceInput` into the `CreateInvoiceDto` body. Empty
 * optional fields are dropped so the request carries only what the operator
 * filled in — the server treats an absent field the same as a blank one.
 */
export function toCreateInvoiceBody(input: CreateInvoiceInput): Record<string, unknown> {
  return {
    branchId: input.branchId,
    patientId: input.patientId,
    visitId: input.visitId || undefined,
    encounterId: input.encounterId || undefined,
    discountAmount: input.discountAmount || undefined,
    taxAmount: input.taxAmount || undefined,
    dueAt: input.dueAt || undefined,
    notes: input.notes || undefined,
    items: input.items.map((line) => ({
      billableItemId: line.billableItemId || undefined,
      medicationId: line.medicationId || undefined,
      description: line.description || undefined,
      quantity: line.quantity,
      unitPrice: line.unitPrice || undefined,
      referenceType: line.referenceType || undefined,
      referenceId: line.referenceId || undefined,
    })),
  };
}
