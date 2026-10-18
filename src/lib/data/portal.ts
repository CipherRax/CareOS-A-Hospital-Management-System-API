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
 * Patient portal (F11) — the profile read.
 *
 * The whole module is self-scoped server-side: every endpoint is `/portal/me/...`
 * and the patient id is derived from the session, never sent. There is no id
 * parameter here for that reason, and there must never be one — a shape where the
 * caller names the record they want is one refactor away from an IDOR.
 *
 * `GET /portal/me` answers `{ patient }`, a demographics allowlist projected by
 * `toPublicPatient` upstream. The generated OpenAPI types the body as unknown, so
 * it is validated structurally and fails closed: a drifted body starves the
 * screen rather than rendering a half-empty record a patient might read as
 * authoritative.
 */

export type PortalCallError = EnvelopeCallError;

export const PORTAL_PATIENT_STATUSES = ['ACTIVE', 'MERGED', 'ARCHIVED'] as const;
export type PortalPatientStatus = (typeof PORTAL_PATIENT_STATUSES)[number];

export interface PortalPatient {
  readonly id: string;
  readonly patientNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Calendar date, `YYYY-MM-DD` (nullable: not every record has one). */
  readonly dateOfBirth: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly status: PortalPatientStatus;
  /** ISO 8601 instant. */
  readonly createdAt: string;
}

/** Reads the public patient projection; returns null when a required field has drifted. */
export function readPortalPatient(value: unknown): PortalPatient | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.patientNumber !== 'string' || value.patientNumber.length === 0) return null;
  if (typeof value.firstName !== 'string' || typeof value.lastName !== 'string') return null;
  if (typeof value.createdAt !== 'string' || value.createdAt.length === 0) return null;
  if (
    typeof value.status !== 'string' ||
    !PORTAL_PATIENT_STATUSES.includes(value.status as PortalPatientStatus)
  ) {
    return null;
  }
  return {
    id: value.id,
    patientNumber: value.patientNumber,
    firstName: value.firstName,
    lastName: value.lastName,
    dateOfBirth: nullableString(value.dateOfBirth),
    phone: nullableString(value.phone),
    email: nullableString(value.email),
    status: value.status as PortalPatientStatus,
    createdAt: value.createdAt,
  };
}

/** Reads the `{ patient }` body of `GET /portal/me`. */
export function extractPortalPatient(
  data: unknown,
): { ok: true; patient: PortalPatient } | { ok: false } {
  if (!isRecord(data)) return { ok: false };
  const patient = readPortalPatient(data.patient);
  return patient ? { ok: true, patient } : { ok: false };
}

/** Raw read against `GET /portal/me` (the caller's own record). */
export async function fetchPortalMe(signal?: AbortSignal): Promise<PortalPatient> {
  const url = `${publicEnv.apiBasePath}/portal/me`;
  return readEnvelope<PortalPatient>(
    url,
    (data) => {
      const parsed = extractPortalPatient(data);
      return parsed.ok ? { ok: true, value: parsed.patient } : { ok: false };
    },
    signal,
  );
}

export const PORTAL_APPOINTMENT_MODES = ['IN_PERSON', 'VIRTUAL'] as const;
export type PortalAppointmentMode = (typeof PORTAL_APPOINTMENT_MODES)[number];

export const PORTAL_APPOINTMENT_STATUSES = [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;
export type PortalAppointmentStatus = (typeof PORTAL_APPOINTMENT_STATUSES)[number];

export interface PortalAppointment {
  readonly id: string;
  readonly departmentId: string;
  readonly providerId: string;
  /** ISO 8601 instant. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly mode: PortalAppointmentMode;
  readonly status: PortalAppointmentStatus;
  readonly reason: string | null;
}

export interface PortalAppointmentPage {
  readonly rows: readonly PortalAppointment[];
  readonly total: number;
}

export interface PortalAppointmentQuery {
  readonly page?: number;
  readonly limit?: number;
}

/** Reads a self-scoped appointment; returns null when a required field has drifted. */
export function readPortalAppointment(value: unknown): PortalAppointment | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.startsAt !== 'string' || value.startsAt.length === 0) return null;
  if (typeof value.endsAt !== 'string' || value.endsAt.length === 0) return null;
  if (
    typeof value.mode !== 'string' ||
    !PORTAL_APPOINTMENT_MODES.includes(value.mode as PortalAppointmentMode)
  ) {
    return null;
  }
  if (
    typeof value.status !== 'string' ||
    !PORTAL_APPOINTMENT_STATUSES.includes(value.status as PortalAppointmentStatus)
  ) {
    return null;
  }
  return {
    id: value.id,
    departmentId: typeof value.departmentId === 'string' ? value.departmentId : '',
    providerId: typeof value.providerId === 'string' ? value.providerId : '',
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    mode: value.mode as PortalAppointmentMode,
    status: value.status as PortalAppointmentStatus,
    reason: nullableString(value.reason),
  };
}

/** Reads the appointment page from the unwrapped `data` plus the sibling `meta`. */
export function extractPortalAppointments(
  data: unknown,
  meta: unknown,
): { ok: true; page: PortalAppointmentPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readPortalAppointment);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: {
      rows: rows as readonly PortalAppointment[],
      total: pageTotal(meta, rows.length),
    },
  };
}

/** Raw read against `GET /portal/me/appointments` (newest first, paginated). */
export async function fetchPortalAppointments(
  query: PortalAppointmentQuery = {},
  signal?: AbortSignal,
): Promise<PortalAppointmentPage> {
  const suffix = queryString({
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/portal/me/appointments${suffix}`;
  return readEnvelope<PortalAppointmentPage>(
    url,
    (data, meta) => {
      const parsed = extractPortalAppointments(data, meta);
      return parsed.ok ? { ok: true, value: parsed.page } : { ok: false };
    },
    signal,
  );
}

export interface PortalLabResult {
  readonly id: string;
  readonly orderId: string;
  readonly itemId: string;
  readonly testId: string;
  readonly testName: string | null;
  readonly value: string;
  readonly unit: string | null;
  readonly referenceMin: string | null;
  readonly referenceMax: string | null;
  /** The result sits outside its reference range. */
  readonly isAbnormal: boolean;
  /** The result is flagged clinically critical — needs attention, not just "off". */
  readonly isCritical: boolean;
  readonly verifiedAt: string | null;
  readonly releasedAt: string | null;
}

export interface PortalLabResultPage {
  readonly rows: readonly PortalLabResult[];
  readonly total: number;
}

export interface PortalLabResultQuery {
  readonly page?: number;
  readonly limit?: number;
}

/** Reads a released lab result; returns null when a required field has drifted. */
export function readPortalLabResult(value: unknown): PortalLabResult | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.value !== 'string') return null;
  if (typeof value.isAbnormal !== 'boolean') return null;
  if (typeof value.isCritical !== 'boolean') return null;
  return {
    id: value.id,
    orderId: typeof value.orderId === 'string' ? value.orderId : '',
    itemId: typeof value.itemId === 'string' ? value.itemId : '',
    testId: typeof value.testId === 'string' ? value.testId : '',
    testName: nullableString(value.testName),
    value: value.value,
    unit: nullableString(value.unit),
    referenceMin: nullableString(value.referenceMin),
    referenceMax: nullableString(value.referenceMax),
    isAbnormal: value.isAbnormal,
    isCritical: value.isCritical,
    verifiedAt: nullableString(value.verifiedAt),
    releasedAt: nullableString(value.releasedAt),
  };
}

/** Reads the lab-result page from the unwrapped `data` plus the sibling `meta`. */
export function extractPortalLabResults(
  data: unknown,
  meta: unknown,
): { ok: true; page: PortalLabResultPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readPortalLabResult);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: {
      rows: rows as readonly PortalLabResult[],
      total: pageTotal(meta, rows.length),
    },
  };
}

/** Raw read against `GET /portal/me/lab-results` (released only, newest first). */
export async function fetchPortalLabResults(
  query: PortalLabResultQuery = {},
  signal?: AbortSignal,
): Promise<PortalLabResultPage> {
  const suffix = queryString({
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/portal/me/lab-results${suffix}`;
  return readEnvelope<PortalLabResultPage>(
    url,
    (data, meta) => {
      const parsed = extractPortalLabResults(data, meta);
      return parsed.ok ? { ok: true, value: parsed.page } : { ok: false };
    },
    signal,
  );
}

export const PORTAL_FEEDBACK_CATEGORIES = [
  'SERVICE',
  'WAITING_TIME',
  'STAFF',
  'BILLING',
  'FACILITY',
  'PHARMACY',
  'LABORATORY',
  'OTHER',
] as const;
export type PortalFeedbackCategory = (typeof PORTAL_FEEDBACK_CATEGORIES)[number];

export interface SubmitPortalFeedbackInput {
  readonly branchId?: string | null;
  readonly category: PortalFeedbackCategory;
  readonly rating: number;
  readonly comment?: string | null;
}

export interface PortalFeedback {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string | null;
  readonly patientId: string | null;
  readonly submittedById: string | null;
  readonly category: PortalFeedbackCategory;
  readonly rating: number;
  readonly comment: string | null;
}

/**
 * Reads the `POST /portal/me/feedback` response (201 `FeedbackResponseDto`) so the
 * success screen shows a confirmed record rather than trusting a typed body. The
 * write is the portal's only mutating call; the patient id is set server-side from
 * the session, so the client sends no id to forge and no id to validate.
 */
export function readPortalFeedback(value: unknown): PortalFeedback | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.rating !== 'number') return null;
  if (
    typeof value.category !== 'string' ||
    !PORTAL_FEEDBACK_CATEGORIES.includes(value.category as PortalFeedbackCategory)
  ) {
    return null;
  }
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    branchId: typeof value.branchId === 'string' ? value.branchId : null,
    patientId: typeof value.patientId === 'string' ? value.patientId : null,
    submittedById: typeof value.submittedById === 'string' ? value.submittedById : null,
    category: value.category as PortalFeedbackCategory,
    rating: value.rating,
    comment: nullableString(value.comment),
  };
}
