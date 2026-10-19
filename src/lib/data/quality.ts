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
 * Quality reads (feedback, complaints, incidents — brief Phase 10).
 *
 * Every list endpoint in this family is mis-typed in the export: `GET /feedback`
 * is declared as `FeedbackResponseDto`, and the complaints/incidents lists as
 * their request DTOs (`ListComplaintsQueryDto`, `ListIncidentsQueryDto`), while
 * the services answer `pageOf(rows.map(serialize), …)` for all three (GAP-020
 * family). So each read here rides the raw-fetch precedent and validates every
 * row structurally; a body that drifts again fails loudly rather than rendering
 * as an empty worklist that a quality officer would read as "nothing reported".
 *
 * The projections below mirror the services' `serialize*` functions exactly, so
 * the same readers serve the worklists today and the detail views later. Nothing
 * here resolves ids to names: a complaint carries `assignedToId` and a staff
 * directory read would be needed to name it, which the list deliberately does
 * not do (see docs/limitations.md).
 */

// ─── Vocabularies (mirror prisma/schema.prisma) ───────────────────────────────

export const FEEDBACK_CATEGORIES = [
  'SERVICE',
  'WAITING_TIME',
  'STAFF',
  'BILLING',
  'FACILITY',
  'PHARMACY',
  'LABORATORY',
  'OTHER',
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const COMPLAINT_ORIGINS = ['PATIENT', 'STAFF', 'OTHER'] as const;
export type ComplaintOrigin = (typeof COMPLAINT_ORIGINS)[number];

export const COMPLAINT_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'INVESTIGATING',
  'RESOLVED',
  'CLOSED',
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const INCIDENT_CATEGORIES = [
  'OUTAGE',
  'EQUIPMENT',
  'STOCK_DISCREPANCY',
  'DATA_ACCESS',
  'FACILITY',
  'PATIENT_SAFETY',
  'OTHER',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'ACTION_PLAN',
  'RESOLVED',
  'CLOSED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type QualityCallError = EnvelopeCallError;

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

/** A feedback record as `FeedbackService.serialize` reports it. */
export interface FeedbackRow {
  readonly id: string;
  readonly branchId: string | null;
  readonly patientId: string | null;
  readonly submittedById: string | null;
  readonly category: FeedbackCategory;
  readonly rating: number;
  readonly comment: string | null;
  readonly status: FeedbackStatus;
  readonly response: string | null;
  readonly handledById: string | null;
  readonly handledAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface FeedbackPage {
  readonly rows: readonly FeedbackRow[];
  readonly total: number;
}

/** Reads one serialized feedback record; returns null when the row is unusable. */
export function readFeedback(value: unknown): FeedbackRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (!oneOf(FEEDBACK_CATEGORIES, value.category)) return null;
  if (!oneOf(FEEDBACK_STATUSES, value.status)) return null;
  const rating = nullableNumber(value.rating);
  if (rating === null) return null;
  return {
    id: value.id,
    branchId: nullableString(value.branchId),
    patientId: nullableString(value.patientId),
    submittedById: nullableString(value.submittedById),
    category: value.category,
    rating,
    comment: nullableString(value.comment),
    status: value.status,
    response: nullableString(value.response),
    handledById: nullableString(value.handledById),
    handledAt: nullableString(value.handledAt),
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt),
  };
}

/** Reads the feedback page from the unwrapped `data` plus the sibling `meta`. */
export function extractFeedbackPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: FeedbackPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readFeedback);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly FeedbackRow[], total: pageTotal(meta, rows.length) },
  };
}

export interface FeedbackQuery {
  readonly category?: FeedbackCategory;
  readonly status?: FeedbackStatus;
  readonly page?: number;
  readonly limit?: number;
}

/** Raw read against `GET /feedback?…` (GAP-020: the 200 is mistyped as the item DTO). */
export async function fetchFeedback(
  query: FeedbackQuery = {},
  signal?: AbortSignal,
): Promise<FeedbackPage> {
  const suffix = queryString({
    category: query.category,
    status: query.status,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/feedback${suffix}`;
  return readEnvelope<FeedbackPage>(
    url,
    (data, meta) => {
      const page = extractFeedbackPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/**
 * The linear feedback lifecycle, mirroring `FEEDBACK_TRANSITIONS` in
 * `src/modules/quality/domain/quality-flow.ts`: each state has exactly one move
 * forward and the last has none.
 */
export const FEEDBACK_NEXT: Record<FeedbackStatus, FeedbackStatus | null> = {
  NEW: 'ACKNOWLEDGED',
  ACKNOWLEDGED: 'RESOLVED',
  RESOLVED: 'CLOSED',
  CLOSED: null,
};

/**
 * Reads the `{ feedback }` body every single-record read and write answers. The
 * export types those as the bare `FeedbackResponseDto` while the service wraps it
 * (GAP-020), so the unwrapped body is validated structurally.
 */
export function readFeedbackRecord(
  payload: unknown,
): { ok: true; feedback: FeedbackRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const feedback = readFeedback(payload.feedback);
  return feedback ? { ok: true, feedback } : { ok: false };
}

/** Raw read against `GET /feedback/{id}` (answers `{ feedback }`, GAP-020). */
export async function fetchFeedbackRecord(
  id: string,
  signal?: AbortSignal,
): Promise<FeedbackRow> {
  const url = `${publicEnv.apiBasePath}/feedback/${encodeURIComponent(id)}`;
  return readEnvelope<FeedbackRow>(
    url,
    (data) => {
      const parsed = readFeedbackRecord(data);
      return parsed.ok ? { ok: true, value: parsed.feedback } : { ok: false };
    },
    signal,
  );
}

export interface RespondFeedbackInput {
  readonly id: string;
  readonly status: FeedbackStatus;
  readonly response?: string;
}

// ─── Complaints ───────────────────────────────────────────────────────────────

/** A complaint as `ComplaintsService.serialize` reports it. */
export interface ComplaintRow {
  readonly id: string;
  readonly branchId: string | null;
  readonly origin: ComplaintOrigin;
  readonly patientId: string | null;
  readonly submittedById: string | null;
  readonly category: string;
  readonly description: string;
  readonly status: ComplaintStatus;
  readonly assignedToId: string | null;
  readonly dueAt: string | null;
  readonly resolution: string | null;
  readonly closedById: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface ComplaintPage {
  readonly rows: readonly ComplaintRow[];
  readonly total: number;
}

/** Reads one serialized complaint; returns null when the row is unusable. */
export function readComplaint(value: unknown): ComplaintRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.category !== 'string' || value.category.length === 0) return null;
  if (typeof value.description !== 'string') return null;
  if (!oneOf(COMPLAINT_ORIGINS, value.origin)) return null;
  if (!oneOf(COMPLAINT_STATUSES, value.status)) return null;
  return {
    id: value.id,
    branchId: nullableString(value.branchId),
    origin: value.origin,
    patientId: nullableString(value.patientId),
    submittedById: nullableString(value.submittedById),
    category: value.category,
    description: value.description,
    status: value.status,
    assignedToId: nullableString(value.assignedToId),
    dueAt: nullableString(value.dueAt),
    resolution: nullableString(value.resolution),
    closedById: nullableString(value.closedById),
    closedAt: nullableString(value.closedAt),
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt),
  };
}

/** Reads the complaint page from the unwrapped `data` plus the sibling `meta`. */
export function extractComplaintPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: ComplaintPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readComplaint);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly ComplaintRow[], total: pageTotal(meta, rows.length) },
  };
}

export interface ComplaintQuery {
  readonly status?: ComplaintStatus;
  readonly assignedToId?: string;
  readonly page?: number;
  readonly limit?: number;
}

/** Raw read against `GET /complaints?…` (GAP-020: the 200 is the query DTO). */
export async function fetchComplaints(
  query: ComplaintQuery = {},
  signal?: AbortSignal,
): Promise<ComplaintPage> {
  const suffix = queryString({
    status: query.status,
    assignedToId: query.assignedToId,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/complaints${suffix}`;
  return readEnvelope<ComplaintPage>(
    url,
    (data, meta) => {
      const page = extractComplaintPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

// ─── Incidents ────────────────────────────────────────────────────────────────

/** An incident as `IncidentsService.serialize` reports it. */
export interface IncidentRow {
  readonly id: string;
  readonly branchId: string;
  readonly category: IncidentCategory;
  readonly severity: IncidentSeverity;
  readonly description: string;
  readonly reportedById: string;
  readonly status: IncidentStatus;
  readonly actionsTaken: string | null;
  readonly resolution: string | null;
  readonly resolvedById: string | null;
  readonly resolvedAt: string | null;
  readonly closedById: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface IncidentPage {
  readonly rows: readonly IncidentRow[];
  readonly total: number;
}

/** Reads one serialized incident; returns null when the row is unusable. */
export function readIncident(value: unknown): IncidentRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.branchId !== 'string' || value.branchId.length === 0) return null;
  if (typeof value.description !== 'string') return null;
  if (typeof value.reportedById !== 'string' || value.reportedById.length === 0) return null;
  if (!oneOf(INCIDENT_CATEGORIES, value.category)) return null;
  if (!oneOf(INCIDENT_SEVERITIES, value.severity)) return null;
  if (!oneOf(INCIDENT_STATUSES, value.status)) return null;
  return {
    id: value.id,
    branchId: value.branchId,
    category: value.category,
    severity: value.severity,
    description: value.description,
    reportedById: value.reportedById,
    status: value.status,
    actionsTaken: nullableString(value.actionsTaken),
    resolution: nullableString(value.resolution),
    resolvedById: nullableString(value.resolvedById),
    resolvedAt: nullableString(value.resolvedAt),
    closedById: nullableString(value.closedById),
    closedAt: nullableString(value.closedAt),
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt),
  };
}

/** Reads the incident page from the unwrapped `data` plus the sibling `meta`. */
export function extractIncidentPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: IncidentPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readIncident);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly IncidentRow[], total: pageTotal(meta, rows.length) },
  };
}

export interface IncidentQuery {
  readonly status?: IncidentStatus;
  readonly severity?: IncidentSeverity;
  readonly category?: IncidentCategory;
  readonly page?: number;
  readonly limit?: number;
}

/** Raw read against `GET /incidents?…` (GAP-020: the 200 is the query DTO). */
export async function fetchIncidents(
  query: IncidentQuery = {},
  signal?: AbortSignal,
): Promise<IncidentPage> {
  const suffix = queryString({
    status: query.status,
    severity: query.severity,
    category: query.category,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/incidents${suffix}`;
  return readEnvelope<IncidentPage>(
    url,
    (data, meta) => {
      const page = extractIncidentPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}
