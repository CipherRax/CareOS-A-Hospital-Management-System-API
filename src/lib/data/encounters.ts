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
 * Encounters (F4 — doctor workspace).
 *
 * Same drift as the queue list (GAP-017 family): the export types `GET
 * /encounters`' 200 as ListEncountersQueryDto with `query: never`, and types
 * every encounter 200 as the bare EncounterResponseDto while the service actually
 * answers `{ encounter: {...} }`. So the list rides the raw-fetch path below; the
 * single read and the status transition use the typed client for the URL/body and
 * validate the unwrapped `{ encounter }` structurally.
 *
 * Lifecycle is OPEN → IN_PROGRESS → COMPLETED (System transitions in
 * `workflow-core.ts`). COMPLETED is terminal: the server locks it even if a demo
 * workflow is customized, so the workspace offers moves exactly on those edges
 * and treats a 409 INVALID_WORKFLOW_TRANSITION as a stale-workspace error.
 */

export const ENCOUNTER_TYPES = [
  'OUTPATIENT',
  'EMERGENCY',
  'FOLLOW_UP',
  'INPATIENT',
  'TELEMEDICINE',
] as const;
export type EncounterType = (typeof ENCOUNTER_TYPES)[number];

export const ENCOUNTER_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

/** Legal next moves per status, mirroring the API's system transitions. */
export const ENCOUNTER_TRANSITIONS: Readonly<Record<EncounterStatus, readonly EncounterStatus[]>> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
};

export interface EncounterPage {
  readonly items: readonly EncounterRow[];
  readonly total: number;
}

export interface EncounterRow {
  readonly id: string;
  readonly branchId: string;
  readonly departmentId: string;
  readonly patientId: string;
  readonly providerId: string | null;
  readonly type: string;
  readonly status: string;
  readonly visitId: string | null;
  readonly appointmentId: string | null;
  readonly note: string | null;
  readonly openedById: string;
  readonly openedAt: string;
  readonly inProgressAt: string | null;
  readonly completedAt: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

/** Reads one serialized encounter; returns null when the row is unusable. */
export function readEncounter(value: unknown): EncounterRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.patientId !== 'string') return null;
  if (typeof value.status !== 'string') return null;
  if (typeof value.openedAt !== 'string') return null;
  return {
    id: value.id,
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    departmentId: typeof value.departmentId === 'string' ? value.departmentId : '',
    patientId: value.patientId,
    providerId: nullableString(value.providerId),
    type: typeof value.type === 'string' ? value.type : 'OUTPATIENT',
    status: value.status,
    visitId: nullableString(value.visitId),
    appointmentId: nullableString(value.appointmentId),
    note: nullableString(value.note),
    openedById: typeof value.openedById === 'string' ? value.openedById : '',
    openedAt: value.openedAt,
    inProgressAt: nullableString(value.inProgressAt),
    completedAt: nullableString(value.completedAt),
    version: typeof value.version === 'number' ? value.version : 0,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : value.openedAt,
  };
}

/**
 * Reads the encounter list from the unwrapped envelope: `data` is the array of
 * encounters and `meta` the pagination sibling. A non-array is a broken body; a
 * genuinely empty array is "no encounters yet".
 */
export function extractEncounterPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: EncounterPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readEncounter);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly EncounterRow[], total } };
}

/** Reads a single-write body: every encounter write answers `{ encounter }`. */
export function extractEncounterRecord(
  payload: unknown,
): { ok: true; encounter: EncounterRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const encounter = readEncounter(payload.encounter);
  if (!encounter) return { ok: false };
  return { ok: true, encounter };
}

/** Shape every encounters raw call rejects with, matching the query error contract. */
export type EncountersCallError = EnvelopeCallError;

export interface EncounterQuery {
  readonly patientId?: string;
  readonly branchId?: string;
  readonly departmentId?: string;
  readonly providerId?: string;
  readonly type?: string;
  readonly status?: string;
}

/**
 * Raw list read against `GET /encounters?…`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO, so this uses the same
 * raw-fetch precedent as the queue board: same-origin fetch, a drift-safe
 * envelope check, then structural row validation.
 */
export async function fetchEncounters(
  query: EncounterQuery = {},
  signal?: AbortSignal,
): Promise<EncounterPage> {
  const suffix = queryString({
    patientId: query.patientId,
    branchId: query.branchId,
    departmentId: query.departmentId,
    providerId: query.providerId,
    type: query.type,
    status: query.status,
  });
  const url = `${publicEnv.apiBasePath}/encounters${suffix}`;
  const parsed = await readEnvelope<EncounterPage>(
    url,
    (data, meta) => {
      const page = extractEncounterPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
  return parsed;
}