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
 * Radiology / imaging results (F4 — doctor results view).
 *
 * Unlike the laboratory list, `GET /radiology/orders` serializes the **full**
 * order including the imaging report, so the list read alone backs the doctor's
 * imaging results — no per-order follow-up fetch. (The write surface — schedule,
 * perform, report, verify, release — is a radiology-department responsibility
 * and belongs to F5, not this view.)
 *
 * Same GAP-020 export drift as every other list: the 200 is typed as
 * `ListRadiologyOrdersQueryDto` with `query: never`, so this rides the raw-fetch
 * path and validates each row structurally.
 */

export const RADIOLOGY_STATUSES = [
  'ORDERED',
  'SCHEDULED',
  'PERFORMED',
  'REPORTED',
  'VERIFIED',
  'RELEASED',
  'CANCELLED',
] as const;
export type RadiologyStatus = (typeof RADIOLOGY_STATUSES)[number];

/** Statuses whose report is written (or further along) — the ones worth showing. */
export const RADIOLOGY_REPORT_STATUSES: readonly RadiologyStatus[] = [
  'REPORTED',
  'VERIFIED',
  'RELEASED',
];

export const IMAGING_MODALITIES = [
  'XRAY',
  'CT',
  'MRI',
  'ULTRASOUND',
  'MAMMOGRAPHY',
  'DEXA',
  'FLUOROSCOPY',
  'OTHER',
] as const;
export type ImagingModality = (typeof IMAGING_MODALITIES)[number];

export interface ImagingReportRow {
  readonly id: string;
  readonly orderId: string;
  readonly findings: string | null;
  readonly summary: string | null;
  readonly impression: string | null;
  readonly enteredById: string | null;
  readonly enteredAt: string | null;
  readonly verifiedById: string | null;
  readonly verifiedAt: string | null;
  readonly version: number;
}

export interface RadiologyOrderRow {
  readonly id: string;
  readonly organizationId: string;
  readonly orderNumber: string;
  readonly patientId: string;
  readonly branchId: string;
  readonly encounterId: string | null;
  readonly modality: ImagingModality;
  readonly region: string | null;
  readonly status: RadiologyStatus;
  readonly clinicalNotes: string | null;
  readonly orderedById: string | null;
  readonly orderedAt: string | null;
  readonly requestedAt: string | null;
  readonly performedById: string | null;
  readonly performedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledReason: string | null;
  readonly releasedById: string | null;
  readonly releasedAt: string | null;
  readonly version: number;
  readonly report: ImagingReportRow | null;
}

export interface RadiologyOrderPage {
  readonly items: readonly RadiologyOrderRow[];
  readonly total: number;
}

/** Reads one imaging report; returns null when the row is unusable. */
export function readImagingReport(value: unknown): ImagingReportRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.orderId !== 'string') return null;
  return {
    id: value.id,
    orderId: value.orderId,
    findings: nullableString(value.findings),
    summary: nullableString(value.summary),
    impression: nullableString(value.impression),
    enteredById: nullableString(value.enteredById),
    enteredAt: nullableString(value.enteredAt),
    verifiedById: nullableString(value.verifiedById),
    verifiedAt: nullableString(value.verifiedAt),
    version: typeof value.version === 'number' ? value.version : 0,
  };
}

/** Reads one serialized radiology order; returns null when the row is unusable. */
export function readRadiologyOrder(value: unknown): RadiologyOrderRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.orderNumber !== 'string') return null;
  if (typeof value.patientId !== 'string') return null;
  if (
    typeof value.status !== 'string' ||
    !RADIOLOGY_STATUSES.includes(value.status as RadiologyStatus)
  ) {
    return null;
  }
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    orderNumber: value.orderNumber,
    patientId: value.patientId,
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    encounterId: nullableString(value.encounterId),
    modality: IMAGING_MODALITIES.includes(value.modality as ImagingModality)
      ? (value.modality as ImagingModality)
      : 'OTHER',
    region: nullableString(value.region),
    status: value.status as RadiologyStatus,
    clinicalNotes: nullableString(value.clinicalNotes),
    orderedById: nullableString(value.orderedById),
    orderedAt: nullableString(value.orderedAt),
    requestedAt: nullableString(value.requestedAt),
    performedById: nullableString(value.performedById),
    performedAt: nullableString(value.performedAt),
    cancelledAt: nullableString(value.cancelledAt),
    cancelledReason: nullableString(value.cancelledReason),
    releasedById: nullableString(value.releasedById),
    releasedAt: nullableString(value.releasedAt),
    version: typeof value.version === 'number' ? value.version : 0,
    report: value.report === undefined || value.report === null ? null : readImagingReport(value.report),
  };
}

/** Reads the order list from the unwrapped envelope (`data` + sibling `meta`). */
export function extractRadiologyOrderPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: RadiologyOrderPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readRadiologyOrder);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly RadiologyOrderRow[], total } };
}

/** Reads a single-order body: the one read answers `{ order }`. */
export function extractRadiologyOrderRecord(
  payload: unknown,
): { ok: true; order: RadiologyOrderRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const order = readRadiologyOrder(payload.order);
  if (!order) return { ok: false };
  return { ok: true, order };
}

/** Shape every radiology raw call rejects with, matching the query error contract. */
export type RadiologyCallError = EnvelopeCallError;

export interface RadiologyOrderQuery {
  readonly patientId?: string;
  readonly branchId?: string;
  readonly status?: RadiologyStatus;
}

/** Raw list read against `GET /radiology/orders?…` (rows carry their report). */
export async function fetchRadiologyOrders(
  query: RadiologyOrderQuery = {},
  signal?: AbortSignal,
): Promise<RadiologyOrderPage> {
  const suffix = queryString({
    patientId: query.patientId,
    branchId: query.branchId,
    status: query.status,
  });
  const url = `${publicEnv.apiBasePath}/radiology/orders${suffix}`;
  return readEnvelope<RadiologyOrderPage>(
    url,
    (data, meta) => {
      const page = extractRadiologyOrderPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}
