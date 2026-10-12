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
 * Medication catalog (F4 — doctor workspace).
 *
 * The prescription composer picks medications from `GET /medications` and list
 * rows resolve their names on demand (prescription items carry only
 * `medicationId`, GAP-018-style). Same export drift as every other list
 * (GAP-020 family): the 200 is typed as ListMedicationsQueryDto with `query:
 * never`, so the list rides the raw-fetch path below.
 */

export const MEDICATION_CATEGORIES = ['MEDICATION', 'SUPPLY'] as const;
export type MedicationCategory = (typeof MEDICATION_CATEGORIES)[number];

export interface MedicationRow {
  readonly id: string;
  readonly organizationId: string;
  readonly category: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly form: string | null;
  readonly unit: string;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly isControlled: boolean;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MedicationPage {
  readonly items: readonly MedicationRow[];
  readonly total: number;
}

/** Reads one serialized medication; returns null when the row is unusable. */
export function readMedication(value: unknown): MedicationRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.name !== 'string') return null;
  if (typeof value.unit !== 'string') return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    category: typeof value.category === 'string' ? value.category : 'MEDICATION',
    name: value.name,
    genericName: nullableString(value.genericName),
    strength: nullableString(value.strength),
    form: nullableString(value.form),
    unit: value.unit,
    sku: nullableString(value.sku),
    barcode: nullableString(value.barcode),
    isControlled: typeof value.isControlled === 'boolean' ? value.isControlled : false,
    isActive: typeof value.isActive === 'boolean' ? value.isActive : true,
    version: typeof value.version === 'number' ? value.version : 0,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

/** Reads the medication list from the unwrapped envelope (`data` + sibling `meta`). */
export function extractMedicationPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: MedicationPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readMedication);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly MedicationRow[], total } };
}

/** Reads a single-write body: every medication write answers `{ medication }`. */
export function extractMedicationRecord(
  payload: unknown,
): { ok: true; medication: MedicationRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const medication = readMedication(payload.medication);
  if (!medication) return { ok: false };
  return { ok: true, medication };
}

/** Shape every medication raw call rejects with, matching the query error contract. */
export type MedicationsCallError = EnvelopeCallError;

export interface MedicationQuery {
  readonly category?: MedicationCategory;
  readonly isActive?: 'true' | 'false';
  readonly search?: string;
}

/**
 * Raw list read against `GET /medications?…`. The export mis-types the 200 as
 * the request DTO with `query: never`, so this uses the raw-fetch precedent.
 */
export async function fetchMedications(
  query: MedicationQuery = {},
  signal?: AbortSignal,
): Promise<MedicationPage> {
  const suffix = queryString({
    category: query.category,
    isActive: query.isActive,
    search: query.search,
  });
  const url = `${publicEnv.apiBasePath}/medications${suffix}`;
  const parsed = await readEnvelope<MedicationPage>(
    url,
    (data, meta) => {
      const page = extractMedicationPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
  return parsed;
}