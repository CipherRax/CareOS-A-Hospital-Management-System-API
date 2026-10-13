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
 * Laboratory results (F4 — doctor results view).
 *
 * The doctor reads released laboratory work; ordering and processing belong to
 * the laboratory module (F5). Two reads back this panel:
 *
 *  - `GET /lab/orders?patientId=…` — the patient's orders, but only as a **thin**
 *    projection: the API serializes the order header, the sample stub and each
 *    item's `testId`, and **omits the results and test names**. The full order
 *    (test names, results, critical flags) lives on the one read below, so a
 *    result-bearing order is fetched by id and cached by React Query.
 *  - `GET /lab/orders/{id}` — the full serialized order with `sample`, `items`
 *    (each named) and `results`.
 *
 * Field metadata (analyte name, unit, reference range) is **not** on the result
 * at all — `LabResult` carries only `testFieldId` — so `GET /lab/tests` supplies
 * the catalog that maps `testFieldId → field` for display (GAP-018-style, the
 * same on-demand naming as patients and medications).
 *
 * Same GAP-020 export drift as every other list: `GET /lab/orders` and
 * `GET /lab/tests` type their 200 as their own request DTO with `query: never`,
 * and `GET /lab/orders/{id}` types the bare entity while the service answers
 * `{ order }`. So the lists ride the raw-fetch path and the single read is
 * validated structurally from the unwrapped `{ order }`.
 */

export const LAB_ORDER_STATUSES = [
  'ORDERED',
  'COLLECTED',
  'RECEIVED',
  'PROCESSING',
  'RESULT_READY',
  'VERIFIED',
  'RELEASED',
  'REJECTED',
  'CANCELLED',
] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];

/** Statuses whose results are entered (or further along) — the ones worth showing. */
export const LAB_RESULT_STATUSES: readonly LabOrderStatus[] = [
  'RESULT_READY',
  'VERIFIED',
  'RELEASED',
];

export const LAB_ORDER_PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'] as const;
export type LabOrderPriority = (typeof LAB_ORDER_PRIORITIES)[number];

export const LAB_SAMPLE_TYPES = [
  'BLOOD',
  'URINE',
  'STOOL',
  'SWAB',
  'SPUTUM',
  'TISSUE',
  'FLUID',
  'OTHER',
] as const;
export type LabSampleType = (typeof LAB_SAMPLE_TYPES)[number];

/** The physical sample mirrors the order through the lifecycle. */
export const LAB_SAMPLE_STATUSES = [
  'ORDERED',
  'COLLECTED',
  'RECEIVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
] as const;
export type LabSampleStatus = (typeof LAB_SAMPLE_STATUSES)[number];

/**
 * The laboratory lifecycle actions, in workflow order. `enter_results` is the
 * one move that carries a body (the values) and lives on its own endpoint; the
 * rest are the plain status moves documented in `domain/lab-flow.ts`.
 */
export const LAB_ORDER_ACTIONS = [
  'collect',
  'receive',
  'process',
  'enter_results',
  'reject',
  'cancel',
  'verify',
  'release',
] as const;
export type LabOrderAction = (typeof LAB_ORDER_ACTIONS)[number];
export type LabOrderTransition = Exclude<LabOrderAction, 'enter_results'>;

/**
 * Which moves the workflow allows from each status — the same edge set the
 * server enforces (`LAB_ALLOWED_FROM`), mirrored so the UI only offers moves the
 * server will accept. A stale tab that offers a move the server no longer allows
 * still gets a 409 in place.
 */
export const LAB_ORDER_ACTIONS_BY_STATUS: Record<LabOrderStatus, readonly LabOrderAction[]> = {
  ORDERED: ['collect', 'cancel'],
  COLLECTED: ['receive', 'reject', 'cancel'],
  RECEIVED: ['process', 'reject'],
  PROCESSING: ['enter_results'],
  RESULT_READY: ['verify'],
  VERIFIED: ['release'],
  RELEASED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const LAB_FIELD_TYPES = ['NUMERIC', 'TEXT', 'CATEGORICAL'] as const;

export interface LabSampleRow {
  readonly id: string;
  readonly sampleNumber: string;
  readonly sampleType: LabSampleType;
  readonly status: LabSampleStatus;
  readonly collectedAt: string | null;
  readonly receivedAt: string | null;
  readonly processingAt: string | null;
  readonly completedAt: string | null;
  readonly rejectedAt: string | null;
  readonly rejectedReason: string | null;
  readonly recollectsFromOrderId: string | null;
}

/**
 * A result that crossed its critical threshold. The notification carries who was
 * told and who acknowledged; release is blocked until every critical has an
 * `acknowledgedAt` (server code `LAB_RESULT_NOT_ACKNOWLEDGED`), so the worklist
 * reads it directly rather than inferring from `isCritical` on the result.
 *
 * The notification points at its result by `resultId`; the field and value live
 * on that result, so callers join back through `items[].results`.
 */
export interface CriticalResultRow {
  readonly id: string;
  readonly organizationId: string;
  readonly resultId: string;
  readonly notifiedToId: string;
  readonly notifiedAt: string | null;
  readonly acknowledgedById: string | null;
  readonly acknowledgedAt: string | null;
  readonly escalationAt: string | null;
}

/**
 * The order header as the list read serializes it — no results, no test names.
 * `items` is reduced to the ordered test ids.
 */
export interface LabOrderSummaryRow {
  readonly id: string;
  readonly organizationId: string;
  readonly orderNumber: string;
  readonly patientId: string;
  readonly branchId: string;
  readonly encounterId: string | null;
  readonly status: LabOrderStatus;
  readonly priority: LabOrderPriority;
  readonly orderedAt: string | null;
  readonly releasedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledReason: string | null;
  readonly rejectionReason: string | null;
  readonly version: number;
  readonly sample: LabSampleRow | null;
  readonly itemTestIds: readonly string[];
}

export interface LabResultRow {
  readonly id: string;
  readonly testFieldId: string;
  readonly value: string;
  readonly isAbnormal: boolean;
  readonly isCritical: boolean;
  readonly currentVersion: number;
  readonly amendments: number;
}

export interface LabOrderItemRow {
  readonly id: string;
  readonly testId: string;
  readonly testCode: string;
  readonly testName: string;
  readonly notes: string | null;
  readonly results: readonly LabResultRow[];
}

/** The full order the single read answers with (test names + results present). */
export interface LabOrderDetail {
  readonly id: string;
  readonly organizationId: string;
  readonly orderNumber: string;
  readonly patientId: string;
  readonly branchId: string;
  readonly encounterId: string | null;
  readonly status: LabOrderStatus;
  readonly priority: LabOrderPriority;
  readonly clinicalNotes: string | null;
  readonly orderedById: string | null;
  readonly orderedAt: string | null;
  readonly releasedById: string | null;
  readonly releasedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledReason: string | null;
  readonly rejectionReason: string | null;
  readonly version: number;
  readonly sample: LabSampleRow | null;
  readonly items: readonly LabOrderItemRow[];
  readonly criticalResults: readonly CriticalResultRow[];
}

export interface LabOrderPage {
  readonly items: readonly LabOrderSummaryRow[];
  readonly total: number;
}

export interface LabTestFieldRow {
  readonly id: string;
  readonly testId: string;
  readonly name: string;
  readonly fieldType: string;
  readonly unit: string | null;
  readonly referenceMin: string | null;
  readonly referenceMax: string | null;
  readonly criticalMin: string | null;
  readonly criticalMax: string | null;
  readonly allowsValues: string | null;
  readonly displayOrder: number;
  readonly isActive: boolean;
}

export interface LabTestRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly sampleType: LabSampleType;
  readonly isActive: boolean;
  readonly fields: readonly LabTestFieldRow[];
}

export interface LabTestPage {
  readonly items: readonly LabTestRow[];
  readonly total: number;
}

export function readLabSample(value: unknown): LabSampleRow | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  return {
    id: value.id,
    sampleNumber: typeof value.sampleNumber === 'string' ? value.sampleNumber : '',
    sampleType: LAB_SAMPLE_TYPES.includes(value.sampleType as LabSampleType)
      ? (value.sampleType as LabSampleType)
      : 'OTHER',
    status: LAB_SAMPLE_STATUSES.includes(value.status as LabSampleStatus)
      ? (value.status as LabSampleStatus)
      : 'ORDERED',
    collectedAt: nullableString(value.collectedAt),
    receivedAt: nullableString(value.receivedAt),
    processingAt: nullableString(value.processingAt),
    completedAt: nullableString(value.completedAt),
    rejectedAt: nullableString(value.rejectedAt),
    rejectedReason: nullableString(value.rejectedReason),
    recollectsFromOrderId: nullableString(value.recollectsFromOrderId),
  };
}

/** Reads one critical-result notification; returns null when the row is unusable. */
export function readCriticalResult(value: unknown): CriticalResultRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.resultId !== 'string') return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    resultId: value.resultId,
    notifiedToId: typeof value.notifiedToId === 'string' ? value.notifiedToId : '',
    notifiedAt: nullableString(value.notifiedAt),
    acknowledgedById: nullableString(value.acknowledgedById),
    acknowledgedAt: nullableString(value.acknowledgedAt),
    escalationAt: nullableString(value.escalationAt),
  };
}

/** Reads one serialized result; returns null when the row is unusable. */
export function readLabResult(value: unknown): LabResultRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.testFieldId !== 'string') return null;
  if (typeof value.value !== 'string') return null;
  return {
    id: value.id,
    testFieldId: value.testFieldId,
    value: value.value,
    isAbnormal: value.isAbnormal === true,
    isCritical: value.isCritical === true,
    currentVersion: typeof value.currentVersion === 'number' ? value.currentVersion : 0,
    amendments: typeof value.amendments === 'number' ? value.amendments : 0,
  };
}

export function readLabOrderItem(value: unknown): LabOrderItemRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.testId !== 'string') return null;
  if (!Array.isArray(value.results)) return null;
  const results = value.results.map(readLabResult);
  if (results.some((result) => result === null)) return null;
  return {
    id: value.id,
    testId: value.testId,
    testCode: typeof value.testCode === 'string' ? value.testCode : '',
    testName: typeof value.testName === 'string' ? value.testName : '',
    notes: nullableString(value.notes),
    results: results as readonly LabResultRow[],
  };
}

/** Reads one list-row order; returns null when the row is unusable. */
export function readLabOrderSummary(value: unknown): LabOrderSummaryRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.orderNumber !== 'string') return null;
  if (typeof value.patientId !== 'string') return null;
  if (
    typeof value.status !== 'string' ||
    !LAB_ORDER_STATUSES.includes(value.status as LabOrderStatus)
  ) {
    return null;
  }

  const itemTestIds: string[] = [];
  if (Array.isArray(value.items)) {
    for (const item of value.items) {
      if (isRecord(item) && typeof item.testId === 'string') itemTestIds.push(item.testId);
    }
  }

  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    orderNumber: value.orderNumber,
    patientId: value.patientId,
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    encounterId: nullableString(value.encounterId),
    status: value.status as LabOrderStatus,
    priority: LAB_ORDER_PRIORITIES.includes(value.priority as LabOrderPriority)
      ? (value.priority as LabOrderPriority)
      : 'ROUTINE',
    orderedAt: nullableString(value.orderedAt),
    releasedAt: nullableString(value.releasedAt),
    cancelledAt: nullableString(value.cancelledAt),
    cancelledReason: nullableString(value.cancelledReason),
    rejectionReason: nullableString(value.rejectionReason),
    version: typeof value.version === 'number' ? value.version : 0,
    sample: value.sample === undefined || value.sample === null ? null : readLabSample(value.sample),
    itemTestIds,
  };
}

/** Reads one full order; returns null when the row is unusable. */
export function readLabOrderDetail(value: unknown): LabOrderDetail | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.orderNumber !== 'string') return null;
  if (typeof value.patientId !== 'string') return null;
  if (
    typeof value.status !== 'string' ||
    !LAB_ORDER_STATUSES.includes(value.status as LabOrderStatus)
  ) {
    return null;
  }
  if (!Array.isArray(value.items)) return null;
  const items = value.items.map(readLabOrderItem);
  if (items.some((item) => item === null)) return null;
  const rawCritical = value.criticalResults ?? [];
  if (!Array.isArray(rawCritical)) return null;
  const criticalResults = rawCritical.map(readCriticalResult);
  if (criticalResults.some((critical) => critical === null)) return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    orderNumber: value.orderNumber,
    patientId: value.patientId,
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    encounterId: nullableString(value.encounterId),
    status: value.status as LabOrderStatus,
    priority: LAB_ORDER_PRIORITIES.includes(value.priority as LabOrderPriority)
      ? (value.priority as LabOrderPriority)
      : 'ROUTINE',
    clinicalNotes: nullableString(value.clinicalNotes),
    orderedById: nullableString(value.orderedById),
    orderedAt: nullableString(value.orderedAt),
    releasedById: nullableString(value.releasedById),
    releasedAt: nullableString(value.releasedAt),
    cancelledAt: nullableString(value.cancelledAt),
    cancelledReason: nullableString(value.cancelledReason),
    rejectionReason: nullableString(value.rejectionReason),
    version: typeof value.version === 'number' ? value.version : 0,
    sample: value.sample === undefined || value.sample === null ? null : readLabSample(value.sample),
    items: items as readonly LabOrderItemRow[],
    criticalResults: criticalResults as readonly CriticalResultRow[],
  };
}

/** Reads one catalog field; returns null when the row is unusable. */
export function readLabTestField(value: unknown): LabTestFieldRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.testId !== 'string') return null;
  if (typeof value.name !== 'string') return null;
  return {
    id: value.id,
    testId: value.testId,
    name: value.name,
    fieldType: typeof value.fieldType === 'string' ? value.fieldType : 'NUMERIC',
    unit: nullableString(value.unit),
    referenceMin: nullableString(value.referenceMin),
    referenceMax: nullableString(value.referenceMax),
    criticalMin: nullableString(value.criticalMin),
    criticalMax: nullableString(value.criticalMax),
    allowsValues: nullableString(value.allowsValues),
    displayOrder: typeof value.displayOrder === 'number' ? value.displayOrder : 0,
    isActive: typeof value.isActive === 'boolean' ? value.isActive : true,
  };
}

/** Reads one catalog test; returns null when the row is unusable. */
export function readLabTest(value: unknown): LabTestRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.code !== 'string') return null;
  if (typeof value.name !== 'string') return null;
  if (!Array.isArray(value.fields)) return null;
  const fields = value.fields.map(readLabTestField);
  if (fields.some((field) => field === null)) return null;
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    sampleType: (value.sampleType as LabSampleType) ?? 'OTHER',
    isActive: typeof value.isActive === 'boolean' ? value.isActive : true,
    fields: fields as readonly LabTestFieldRow[],
  };
}

/** Reads the order list from the unwrapped envelope (`data` + sibling `meta`). */
export function extractLabOrderPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: LabOrderPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readLabOrderSummary);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly LabOrderSummaryRow[], total } };
}

/** Reads a single-order body: `GET /lab/orders/{id}` answers `{ order }`. */
export function extractLabOrderRecord(
  payload: unknown,
): { ok: true; order: LabOrderDetail } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const order = readLabOrderDetail(payload.order);
  if (!order) return { ok: false };
  return { ok: true, order };
}

/** Reads the catalog list from the unwrapped envelope (`data` + sibling `meta`). */
export function extractLabTestPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: LabTestPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readLabTest);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly LabTestRow[], total } };
}

/** Shape every laboratory raw call rejects with, matching the query error contract. */
export type LaboratoryCallError = EnvelopeCallError;

export interface LabOrderQuery {
  readonly patientId?: string;
  readonly branchId?: string;
  readonly status?: LabOrderStatus;
}

export interface LabTestsQuery {
  readonly active?: 'true' | 'false';
}

/** Raw list read against `GET /lab/orders?…` (the export mis-types the 200 DTO). */
export async function fetchLabOrders(
  query: LabOrderQuery = {},
  signal?: AbortSignal,
): Promise<LabOrderPage> {
  const suffix = queryString({
    patientId: query.patientId,
    branchId: query.branchId,
    status: query.status,
  });
  const url = `${publicEnv.apiBasePath}/lab/orders${suffix}`;
  return readEnvelope<LabOrderPage>(
    url,
    (data, meta) => {
      const page = extractLabOrderPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw list read against `GET /lab/tests?…` (the catalog behind field names). */
export async function fetchLabTests(
  query: LabTestsQuery = {},
  signal?: AbortSignal,
): Promise<LabTestPage> {
  const suffix = queryString({ active: query.active });
  const url = `${publicEnv.apiBasePath}/lab/tests${suffix}`;
  return readEnvelope<LabTestPage>(
    url,
    (data, meta) => {
      const page = extractLabTestPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}
