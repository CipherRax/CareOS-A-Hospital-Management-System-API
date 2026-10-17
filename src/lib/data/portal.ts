import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableString,
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
