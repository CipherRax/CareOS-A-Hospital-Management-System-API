import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableString,
  nullableNumber,
  pageTotal,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Prescriptions (F4 — doctor workspace).
 *
 * A prescription pins the patient, the issuing provider and the branch where
 * dispensing happens; it is not linked to an encounter, so the workspace shows
 * the patient's prescription history and the doctor writes to it with the
 * patient id of the visit at hand.
 *
 * Export drift (GAP-020 family, same as encounters/clinical notes): `GET
 * /prescriptions`' 200 is typed as ListPrescriptionsQueryDto with `query:
 * never`, and every prescription 200 is typed as the bare PrescriptionResponseDto
 * while the service actually answers `{ prescription: {...} }`. So the list
 * rides the raw-fetch path below; the create and action endpoints use the typed
 * client for the URL/body and validate the unwrapped `{ prescription }`
 * structurally.
 */

export const PRESCRIPTION_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_DISPENSED',
  'DISPENSED',
  'CANCELLED',
] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

/** Actions the doctor is allowed to take (dispensing lives in pharmacy). */
export const PRESCRIPTION_ACTIONS = ['issue', 'cancel'] as const;
export type PrescriptionAction = (typeof PRESCRIPTION_ACTIONS)[number];

/** Legal actions per status, mirroring the API domain (`prescription-flow.ts`). */
export const PRESCRIPTION_ACTIONS_BY_STATUS: Readonly<
  Record<PrescriptionStatus, readonly PrescriptionAction[]>
> = {
  DRAFT: ['issue', 'cancel'],
  ISSUED: ['cancel'],
  PARTIALLY_DISPENSED: ['cancel'],
  DISPENSED: [],
  CANCELLED: [],
};

export interface PrescriptionItemRow {
  readonly id: string;
  readonly medicationId: string;
  readonly quantity: number;
  readonly dispensedQuantity: number;
  readonly dosage: string | null;
  readonly frequency: string | null;
  readonly durationDays: number | null;
  readonly instructions: string | null;
}

export interface PrescriptionRow {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly providerId: string;
  readonly status: PrescriptionStatus;
  readonly notes: string | null;
  readonly issuedById: string | null;
  readonly issuedAt: string | null;
  readonly dispensedAt: string | null;
  readonly cancelledById: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly version: number;
  readonly items: readonly PrescriptionItemRow[];
}

export interface PrescriptionPage {
  readonly items: readonly PrescriptionRow[];
  readonly total: number;
}

/** Reads one serialized prescription item; returns null when the row is unusable. */
export function readPrescriptionItem(value: unknown): PrescriptionItemRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.medicationId !== 'string') return null;
  if (typeof value.quantity !== 'number') return null;
  return {
    id: value.id,
    medicationId: value.medicationId,
    quantity: value.quantity,
    dispensedQuantity: typeof value.dispensedQuantity === 'number' ? value.dispensedQuantity : 0,
    dosage: nullableString(value.dosage),
    frequency: nullableString(value.frequency),
    durationDays: nullableNumber(value.durationDays),
    instructions: nullableString(value.instructions),
  };
}

/** Reads one serialized prescription; returns null when the row is unusable. */
export function readPrescription(value: unknown): PrescriptionRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.patientId !== 'string') return null;
  if (typeof value.providerId !== 'string') return null;
  if (
    typeof value.status !== 'string' ||
    !PRESCRIPTION_STATUSES.includes(value.status as PrescriptionStatus)
  ) {
    return null;
  }
  if (!Array.isArray(value.items)) return null;
  const items = value.items.map(readPrescriptionItem);
  if (items.some((item) => item === null)) return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    patientId: value.patientId,
    providerId: value.providerId,
    status: value.status as PrescriptionStatus,
    notes: nullableString(value.notes),
    issuedById: nullableString(value.issuedById),
    issuedAt: nullableString(value.issuedAt),
    dispensedAt: nullableString(value.dispensedAt),
    cancelledById: nullableString(value.cancelledById),
    cancelledAt: nullableString(value.cancelledAt),
    cancelReason: nullableString(value.cancelReason),
    version: typeof value.version === 'number' ? value.version : 0,
    items: items as readonly PrescriptionItemRow[],
  };
}

/**
 * Reads the prescription list from the unwrapped envelope: `data` is the array
 * of prescriptions and `meta` the pagination sibling.
 */
export function extractPrescriptionPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: PrescriptionPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readPrescription);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly PrescriptionRow[], total } };
}

/** Reads a single-write body: every prescription write answers `{ prescription }`. */
export function extractPrescriptionRecord(
  payload: unknown,
): { ok: true; prescription: PrescriptionRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const prescription = readPrescription(payload.prescription);
  if (!prescription) return { ok: false };
  return { ok: true, prescription };
}

/** Shape every prescriptions raw call rejects with, matching the query error contract. */
export type PrescriptionsCallError = EnvelopeCallError;

export interface PrescriptionQuery {
  readonly patientId?: string;
  readonly branchId?: string;
  readonly providerId?: string;
  readonly status?: PrescriptionStatus;
}

/**
 * Raw list read against `GET /prescriptions?…`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO, so this uses the same
 * raw-fetch precedent as the encounter list.
 */
export async function fetchPrescriptions(
  query: PrescriptionQuery = {},
  signal?: AbortSignal,
): Promise<PrescriptionPage> {
  const suffix = queryString({
    patientId: query.patientId,
    branchId: query.branchId,
    providerId: query.providerId,
    status: query.status,
  });
  const url = `${publicEnv.apiBasePath}/prescriptions${suffix}`;
  const parsed = await readEnvelope<PrescriptionPage>(
    url,
    (data, meta) => {
      const page = extractPrescriptionPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
  return parsed;
}