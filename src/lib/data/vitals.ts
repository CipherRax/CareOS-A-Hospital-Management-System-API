import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableNumber,
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Nursing vitals (F3).
 *
 * The exported document mis-types every vitals 200 as the operation's *request*
 * DTO — `GET /vitals` is typed `ListVitalsQueryDto`, `POST /vitals` is typed
 * `RecordVitalDto` — and leaves the list query unmodelled (`query: never`). The
 * real bodies come from `vitals.service.ts` (`{ items, meta }`,
 * `{ vitalRecord }`), so every body below is validated structurally rather than
 * trusted. Same defect as the queue and appointments (GAP-017), widened here.
 *
 * Vitals are **append-only**. A correction never edits a row; it creates a new
 * record that points at the superseded one through `correctionOfId` and carries
 * a mandatory `correctionReason`. The screen renders the chain by reading the
 * latest record first and marking rows that were later corrected.
 *
 * BMI is computed server-side (`vitals/domain/bmi.ts`) from the recorded
 * height/weight and is never trusted from the wire; the category here is only the
 * API's own string, mapped to a tone for display.
 */

export const VITAL_MEASUREMENT_KEYS = [
  'temperatureC',
  'systolicMmHg',
  'diastolicMmHg',
  'pulseBpm',
  'respiratoryRate',
  'spo2',
  'weightKg',
  'heightCm',
  'painScore',
] as const;
export type VitalMeasurementKey = (typeof VITAL_MEASUREMENT_KEYS)[number];

/** Every field the record/correct refine counts as "content". `notes` included. */
export const VITAL_FIELD_KEYS = [...VITAL_MEASUREMENT_KEYS, 'notes'] as const;
export type VitalFieldKey = (typeof VITAL_FIELD_KEYS)[number];

export interface VitalFieldSpec {
  readonly key: VitalMeasurementKey;
  readonly labelKey: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly integer: boolean;
}

/**
 * The form's field metadata, mirroring `RecordVitalSchema`'s bounds exactly so a
 * value the input accepts is a value the API accepts. `step` is 1 for the
 * integer measures and `any` for the two decimals (temperature, weight).
 */
export const VITAL_FIELD_SPECS: readonly VitalFieldSpec[] = [
  { key: 'temperatureC', labelKey: 'field.temperatureC', unit: '°C', min: 28, max: 47, step: 0.1, integer: false },
  { key: 'systolicMmHg', labelKey: 'field.systolicMmHg', unit: 'mmHg', min: 40, max: 300, step: 1, integer: true },
  { key: 'diastolicMmHg', labelKey: 'field.diastolicMmHg', unit: 'mmHg', min: 20, max: 200, step: 1, integer: true },
  { key: 'pulseBpm', labelKey: 'field.pulseBpm', unit: 'bpm', min: 20, max: 300, step: 1, integer: true },
  { key: 'respiratoryRate', labelKey: 'field.respiratoryRate', unit: 'breaths/min', min: 4, max: 100, step: 1, integer: true },
  { key: 'spo2', labelKey: 'field.spo2', unit: '%', min: 40, max: 100, step: 1, integer: true },
  { key: 'weightKg', labelKey: 'field.weightKg', unit: 'kg', min: 1, max: 500, step: 0.1, integer: false },
  { key: 'heightCm', labelKey: 'field.heightCm', unit: 'cm', min: 60, max: 260, step: 0.1, integer: false },
  { key: 'painScore', labelKey: 'field.painScore', unit: '/10', min: 0, max: 10, step: 1, integer: true },
];

export const BMI_CATEGORIES = ['UNDERWEIGHT', 'NORMAL', 'OVERWEIGHT', 'OBESE'] as const;
export type BmiCategory = (typeof BMI_CATEGORIES)[number];

export interface VitalRow {
  readonly id: string;
  readonly patientId: string;
  readonly visitId: string | null;
  readonly temperatureC: number | null;
  readonly systolicMmHg: number | null;
  readonly diastolicMmHg: number | null;
  readonly pulseBpm: number | null;
  readonly respiratoryRate: number | null;
  readonly spo2: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly bmi: number | null;
  readonly bmiCategory: string | null;
  readonly painScore: number | null;
  readonly notes: string | null;
  readonly observedAt: string | null;
  readonly correctionOfId: string | null;
  readonly correctionReason: string | null;
  readonly recordedByUserId: string | null;
  readonly createdAt: string | null;
}

export interface VitalPage {
  readonly items: readonly VitalRow[];
  readonly total: number;
}

function isUsableVitalRow(
  value: unknown,
): value is { readonly id: string; readonly patientId: string } & Record<string, unknown> {
  return isRecord(value) && typeof value.id === 'string' && typeof value.patientId === 'string';
}

/** Reads one serialized vital record; returns null when the row is unusable. */
export function readVital(value: unknown): VitalRow | null {
  if (!isUsableVitalRow(value)) return null;
  return {
    id: value.id,
    patientId: value.patientId,
    visitId: nullableString(value.visitId),
    temperatureC: nullableNumber(value.temperatureC),
    systolicMmHg: nullableNumber(value.systolicMmHg),
    diastolicMmHg: nullableNumber(value.diastolicMmHg),
    pulseBpm: nullableNumber(value.pulseBpm),
    respiratoryRate: nullableNumber(value.respiratoryRate),
    spo2: nullableNumber(value.spo2),
    weightKg: nullableNumber(value.weightKg),
    heightCm: nullableNumber(value.heightCm),
    bmi: nullableNumber(value.bmi),
    bmiCategory: nullableString(value.bmiCategory),
    painScore: nullableNumber(value.painScore),
    notes: nullableString(value.notes),
    observedAt: nullableString(value.observedAt),
    correctionOfId: nullableString(value.correctionOfId),
    correctionReason: nullableString(value.correctionReason),
    recordedByUserId: nullableString(value.recordedByUserId),
    createdAt: nullableString(value.createdAt),
  };
}

/**
 * Reads a vitals page from the unwrapped envelope: `data` is the array of
 * records and `meta` carries the total. An empty array is a patient with no
 * observations, which is a valid state, not a broken body.
 */
export function extractVitalPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: VitalPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readVital);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly VitalRow[], total } };
}

/** Reads the `{ vitalRecord }` body a record/correct answers with. */
export function extractVitalRecord(
  payload: unknown,
): { ok: true; record: VitalRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const record = readVital(payload.vitalRecord);
  return record ? { ok: true, record } : { ok: false };
}

/**
 * Reads the set of ids that were later superseded by a correction.
 *
 * A row's whole meaning changes once a correction exists: it is history, not the
 * current observation. The screen marks those rows rather than hiding them, so
 * the record stays auditable.
 */
export function correctedIds(rows: readonly VitalRow[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.correctionOfId) ids.add(row.correctionOfId);
  }
  return ids;
}

/** Vitals ordered newest observation first, matching the API's own ordering. */
export function byObservedAt(rows: readonly VitalRow[]): VitalRow[] {
  return [...rows].sort((a, b) => {
    const aTime = Date.parse(a.observedAt ?? a.createdAt ?? '');
    const bTime = Date.parse(b.observedAt ?? b.createdAt ?? '');
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  });
}

/**
 * Whether a record/correct payload carries any content at all.
 *
 * Mirrors `RecordVitalSchema`'s refine, which counts every vital field (including
 * `notes`). Without this a form with every box empty posts a 400 and the user
 * sees a generic failure for a check that was knowable here.
 */
export function hasVitalContent(input: Record<string, unknown>): boolean {
  return VITAL_FIELD_KEYS.some((key) => input[key] !== undefined && input[key] !== null && input[key] !== '');
}

/** Shape every vitals raw call rejects with, matching the query error contract. */
export type VitalsCallError = EnvelopeCallError;

export interface VitalsQuery {
  readonly patientId: string;
  readonly visitId?: string;
}

/** Raw vitals read against `GET /vitals` (unmodelled query, mis-typed body). */
export async function fetchVitals(
  query: VitalsQuery,
  signal?: AbortSignal,
): Promise<VitalPage> {
  const url = `${publicEnv.apiBasePath}/vitals${queryString({
    patientId: query.patientId,
    visitId: query.visitId,
    limit: '100',
  })}`;
  return readEnvelope<VitalPage>(
    url,
    (data, meta) => {
      const page = extractVitalPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}
