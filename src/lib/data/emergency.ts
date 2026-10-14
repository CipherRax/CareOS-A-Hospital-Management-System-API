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
 * Emergency department (F8 — emergency desk).
 *
 * `GET /emergency/visits` types its 200 as the request DTO (`ListEmergencyVisitsQueryDto`)
 * while the service answers a `PageResult`, and `GET /emergency/visits/{id}` types
 * the bare `EmergencyVisitResponseDto` while the service answers `{ visit }`
 * (GAP-020 family). Both therefore ride the raw-fetch path and are validated
 * structurally: a body that drifts fails closed rather than rendering an ED row
 * with the wrong status or priority.
 *
 * The visit is one row that accumulates the whole encounter — arrival, triage,
 * assessment, treatment, observation and one final disposition. The status is
 * the workflow state; `priority` and `disposition` are the triage and outcome
 * enums; the terminal statuses are `DISCHARGED`, `ADMITTED` and `REFERRED`.
 */

export const EMERGENCY_STATUSES = [
  'ARRIVED',
  'TRIAGED',
  'ASSESSED',
  'IN_TREATMENT',
  'OBSERVATION',
  'DISCHARGED',
  'ADMITTED',
  'REFERRED',
] as const;
export type EmergencyVisitStatus = (typeof EMERGENCY_STATUSES)[number];

export const EMERGENCY_PRIORITIES = [
  'RESUSCITATION',
  'EMERGENT',
  'URGENT',
  'SEMI_URGENT',
  'NON_URGENT',
] as const;
export type EmergencyPriority = (typeof EMERGENCY_PRIORITIES)[number];

export const EMERGENCY_DISPOSITIONS = ['ADMITTED', 'REFERRED', 'DISCHARGED'] as const;
export type EmergencyDisposition = (typeof EMERGENCY_DISPOSITIONS)[number];

/** The branch the ED registers arrivals in — the EXAMPLE branch (GAP-018). */
export const EMERGENCY_BRANCH_ID = 'br_example_0001';

export interface EmergencyVisitRow {
  readonly id: string;
  readonly organizationId: string;
  readonly visitNumber: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly status: EmergencyVisitStatus;
  readonly priority: EmergencyPriority | null;
  readonly registeredById: string | null;
  readonly arrivedById: string | null;
  readonly arrivedAt: string;
  readonly chiefComplaint: string | null;
  readonly triagedById: string | null;
  readonly triagedAt: string | null;
  readonly assessedAt: string | null;
  readonly assessment: string | null;
  readonly treatmentStartedAt: string | null;
  readonly treatment: string | null;
  readonly observedAt: string | null;
  readonly dispositionAt: string | null;
  readonly disposition: EmergencyDisposition | null;
  readonly admittedAdmissionId: string | null;
  readonly referredTo: string | null;
  readonly referralNotes: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EmergencyVisitPage {
  readonly rows: readonly EmergencyVisitRow[];
  readonly total: number;
}

export interface EmergencyVisitQuery {
  readonly branchId?: string;
  readonly patientId?: string;
  readonly status?: EmergencyVisitStatus;
  readonly priority?: EmergencyPriority;
  readonly page?: number;
  readonly limit?: number;
}

export interface EmergencySummaryRow {
  readonly period: 'TODAY';
  readonly arrivals: number;
  readonly active: number;
  readonly avgMinutesToTriage: number;
  readonly avgMinutesToDisposition: number;
  readonly byPriority: Readonly<Record<string, number>>;
  readonly byDisposition: Readonly<Record<string, number>>;
}

export interface RegisterEmergencyVisitInput {
  readonly patientId: string;
  readonly branchId?: string;
  readonly arrivedAt?: string;
}

export interface TriageEmergencyVisitInput {
  readonly id: string;
  readonly priority: EmergencyPriority;
  readonly complaint?: string;
}

export interface SetEmergencyPriorityInput {
  readonly id: string;
  readonly priority: EmergencyPriority;
}

export interface AssessEmergencyVisitInput {
  readonly id: string;
  readonly assessment?: string;
}

export interface TreatEmergencyVisitInput {
  readonly id: string;
  readonly treatment?: string;
}

export interface AdmitFromEmergencyInput {
  readonly id: string;
  readonly bedId: string;
  readonly departmentId?: string;
  readonly provisionalDiagnosis?: string;
  readonly expectedDischargeAt?: string;
}

export interface ReferEmergencyVisitInput {
  readonly id: string;
  readonly referredTo: string;
  readonly referralNotes?: string;
}

export type EmergencyCallError = EnvelopeCallError;

const EMERGENCY_TERMINAL: readonly EmergencyVisitStatus[] = ['DISCHARGED', 'ADMITTED', 'REFERRED'];

/** A visit in a final disposition cannot be moved further. */
export function isEmergencyTerminal(status: EmergencyVisitStatus): boolean {
  return EMERGENCY_TERMINAL.includes(status);
}

/** Reads one serialized visit; returns null when a required field has drifted. */
export function readEmergencyVisit(value: unknown): EmergencyVisitRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.visitNumber !== 'string') return null;
  if (typeof value.patientId !== 'string' || typeof value.branchId !== 'string') return null;
  if (typeof value.status !== 'string' || !EMERGENCY_STATUSES.includes(value.status as EmergencyVisitStatus)) {
    return null;
  }
  if (typeof value.arrivedAt !== 'string') return null;
  if (value.priority != null && !isPriority(value.priority)) return null;
  if (value.disposition != null && !isDisposition(value.disposition)) return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    visitNumber: value.visitNumber,
    branchId: value.branchId,
    patientId: value.patientId,
    status: value.status as EmergencyVisitStatus,
    priority: (value.priority ?? null) as EmergencyPriority | null,
    registeredById: nullableString(value.registeredById),
    arrivedById: nullableString(value.arrivedById),
    arrivedAt: value.arrivedAt,
    chiefComplaint: nullableString(value.chiefComplaint),
    triagedById: nullableString(value.triagedById),
    triagedAt: nullableString(value.triagedAt),
    assessedAt: nullableString(value.assessedAt),
    assessment: nullableString(value.assessment),
    treatmentStartedAt: nullableString(value.treatmentStartedAt),
    treatment: nullableString(value.treatment),
    observedAt: nullableString(value.observedAt),
    dispositionAt: nullableString(value.dispositionAt),
    disposition: (value.disposition ?? null) as EmergencyDisposition | null,
    admittedAdmissionId: nullableString(value.admittedAdmissionId),
    referredTo: nullableString(value.referredTo),
    referralNotes: nullableString(value.referralNotes),
    version: typeof value.version === 'number' ? value.version : 0,
    createdAt: nullableString(value.createdAt) ?? '',
    updatedAt: nullableString(value.updatedAt) ?? '',
  };
}

function isPriority(value: unknown): boolean {
  return typeof value === 'string' && EMERGENCY_PRIORITIES.includes(value as EmergencyPriority);
}

function isDisposition(value: unknown): boolean {
  return typeof value === 'string' && EMERGENCY_DISPOSITIONS.includes(value as EmergencyDisposition);
}

/** Reads the visit page from the unwrapped `data` plus the sibling `meta`. */
export function extractEmergencyVisitPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: EmergencyVisitPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readEmergencyVisit);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly EmergencyVisitRow[], total: pageTotal(meta, rows.length) },
  };
}

/** Reads a single-visit body: reads and writes answer `{ visit }`. */
export function extractEmergencyVisitRecord(
  payload: unknown,
): { ok: true; visit: EmergencyVisitRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const visit = readEmergencyVisit(payload.visit);
  return visit ? { ok: true, visit } : { ok: false };
}

/** Reads the summary body; a missing metrics object fails closed. */
export function extractEmergencySummary(payload: unknown): EmergencySummaryRow | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.arrivals !== 'number' || typeof payload.active !== 'number') return null;
  return {
    period: 'TODAY',
    arrivals: payload.arrivals,
    active: payload.active,
    avgMinutesToTriage: typeof payload.avgMinutesToTriage === 'number' ? payload.avgMinutesToTriage : 0,
    avgMinutesToDisposition:
      typeof payload.avgMinutesToDisposition === 'number' ? payload.avgMinutesToDisposition : 0,
    byPriority: readCounts(payload.byPriority),
    byDisposition: readCounts(payload.byDisposition),
  };
}

function readCounts(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) return {};
  const counts: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number') counts[key] = raw;
  }
  return counts;
}

/** Raw read against `GET /emergency/visits?{filters}` (GAP-020). */
export async function fetchEmergencyVisits(
  query: EmergencyVisitQuery = {},
  signal?: AbortSignal,
): Promise<EmergencyVisitPage> {
  const suffix = queryString({
    branchId: query.branchId,
    patientId: query.patientId,
    status: query.status,
    priority: query.priority,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/emergency/visits${suffix}`;
  return readEnvelope<EmergencyVisitPage>(
    url,
    (data, meta) => {
      const page = extractEmergencyVisitPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /emergency/visits/{id}` (the service answers `{ visit }`). */
export async function fetchEmergencyVisit(
  id: string,
  signal?: AbortSignal,
): Promise<EmergencyVisitRow> {
  const url = `${publicEnv.apiBasePath}/emergency/visits/${encodeURIComponent(id)}`;
  return readEnvelope<EmergencyVisitRow>(
    url,
    (data) => {
      const parsed = extractEmergencyVisitRecord(data);
      return parsed.ok ? { ok: true, value: parsed.visit } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /emergency/summary` (the service answers the metrics body). */
export async function fetchEmergencySummary(signal?: AbortSignal): Promise<EmergencySummaryRow> {
  const url = `${publicEnv.apiBasePath}/emergency/summary`;
  return readEnvelope<EmergencySummaryRow>(
    url,
    (data) => {
      const summary = extractEmergencySummary(data);
      return summary ? { ok: true, value: summary } : { ok: false };
    },
    signal,
  );
}
