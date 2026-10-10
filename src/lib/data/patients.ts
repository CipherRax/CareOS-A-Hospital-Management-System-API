import { publicEnv } from '@/lib/env';

/**
 * Patient registry (F2 — reception).
 *
 * The exported `careos.openapi.json` gets the *happy* parts of the registry right:
 * `GET /patients` returns `{ items, meta }` of serialized patients, and
 * `POST /patients` can 409 `POSSIBLE_DUPLICATE`. It under-specifies the rest:
 *
 *  - Search parameters (`q`, `page`, `limit`, `status`) are exercised live but
 *    the export types them as absent (`query: never`), so search cannot ride the
 *    typed client and takes the raw-fetch path below — the same precedent as the
 *    facility directory (GAP-012).
 *  - `GET /patients/{id}/master` 200 is typed `PatientResponseDto` in the export
 *    while the live API returns a `{ patient, sections }` envelope (GAP-013), so
 *    the master response is validated structurally instead of trusted.
 *  - Sub-entity rows (guardians, consents, allergies, history) are returned as
 *    raw rows and are not modelled at all (GAP-014).
 *
 * A drifted response therefore fails into "record unavailable" or "search
 * unavailable" — never into a list or record that *looks* healthy with fields
 * missing, because the alternative is a receptionist trusting a banner built
 * from a body that was silently misread.
 */

export interface PatientListItem {
  readonly id: string;
  readonly patientNumber: string;
  readonly displayName: string;
  readonly dateOfBirth: string | null;
  readonly sex: string | null;
  readonly phone: string | null;
  readonly county: string | null;
  readonly town: string | null;
  readonly status: string;
  readonly version: number;
}

export interface PatientListPage {
  readonly items: readonly PatientListItem[];
  readonly total: number;
}

export interface GuardianRow {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly relationship: string;
  readonly isPrimary?: boolean;
  readonly isEmergencyContact?: boolean;
}

export interface ConsentRow {
  readonly type: string;
  readonly status: string;
}

export interface AllergyRow {
  readonly substance: string;
  readonly severity: string | null;
  readonly status: string;
  readonly reaction: string | null;
}

export interface MedicalHistoryRow {
  readonly category: string;
  readonly description: string;
  readonly onsetDate: string | null;
}

export interface PatientMasterRecord {
  readonly patient: PatientListItem;
  readonly sections: {
    readonly guardians: readonly GuardianRow[];
    readonly consents: readonly ConsentRow[];
    readonly allergies: readonly AllergyRow[];
    readonly medicalHistory: readonly MedicalHistoryRow[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Joins the name parts a serialized patient ships, ignoring blanks. */
export function buildDisplayName(
  firstName: unknown,
  otherNames: unknown,
  lastName: unknown,
): string {
  const parts = [firstName, otherNames, lastName].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );
  return parts.map((part) => part.trim()).join(' ');
}

/** Reads one serialized patient row; returns null when the row is unusable. */
export function readPatientRow(value: unknown): PatientListItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.patientNumber !== 'string') return null;
  const displayName = buildDisplayName(value.firstName, value.otherNames, value.lastName);
  if (!displayName) return null;
  return {
    id: typeof value.id === 'string' ? value.id : '',
    patientNumber: value.patientNumber,
    displayName,
    dateOfBirth: typeof value.dateOfBirth === 'string' ? value.dateOfBirth : null,
    sex: typeof value.sex === 'string' ? value.sex : null,
    phone: typeof value.phone === 'string' ? value.phone : null,
    county: typeof value.county === 'string' ? value.county : null,
    town: typeof value.town === 'string' ? value.town : null,
    status: typeof value.status === 'string' ? value.status : '',
    version: typeof value.version === 'number' ? value.version : 0,
  };
}

/**
 * Reads a search result page (`GET /patients`).
 *
 * Envelope is `{ success, data: { items, meta: { total } } }`. An envelope with a
 * usable shape but rows that do not read as patients is a broken response, not a
 * zero-result search; only a genuinely empty `items` array counts as "no matches".
 */
export function extractPatientList(
  body: unknown,
): { ok: true; page: PatientListPage } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  if (body.success !== true) return { ok: false };
  const data = body.data;
  if (!isRecord(data)) return { ok: false };
  if (!Array.isArray(data.items)) return { ok: false };

  const items = data.items.map(readPatientRow);
  if (items.some((item) => item === null)) return { ok: false };
  const meta = isRecord(data.meta) ? data.meta : {};
  const total = typeof meta.total === 'number' ? meta.total : items.length;
  return { ok: true, page: { items: items as readonly PatientListItem[], total } };
}

function rowList<Row>(value: unknown, validateRow: (row: unknown) => Row | null) {
  if (!Array.isArray(value)) return { ok: false as const, items: [] as readonly Row[] };
  const items: Array<Row | null> = value.map(validateRow);
  if (items.some((item) => item === null)) return { ok: false as const, items: [] as const };
  return { ok: true as const, items: items as readonly Row[] };
}

function readGuardians(value: unknown): { ok: boolean; items: readonly GuardianRow[] } {
  return rowList<GuardianRow>(value, (row) => {
    if (!isRecord(row)) return null;
    if (typeof row.firstName !== 'string' || typeof row.lastName !== 'string') return null;
    const relationship =
      typeof row.relationship === 'string' ? row.relationship : row.relationshipLabel;
    if (typeof relationship !== 'string' || relationship.length === 0) return null;
    return {
      id: typeof row.id === 'string' ? row.id : '',
      firstName: row.firstName,
      lastName: row.lastName,
      phone: typeof row.phone === 'string' ? row.phone : null,
      email: typeof row.email === 'string' ? row.email : null,
      relationship,
      isPrimary: typeof row.isPrimary === 'boolean' ? row.isPrimary : undefined,
      isEmergencyContact:
        typeof row.isEmergencyContact === 'boolean' ? row.isEmergencyContact : undefined,
    };
  });
}

function readConsents(value: unknown): { ok: boolean; items: readonly ConsentRow[] } {
  return rowList<ConsentRow>(value, (row) => {
    if (!isRecord(row)) return null;
    const type = typeof row.type === 'string' ? row.type : '';
    const status =
      typeof row.status === 'string'
        ? row.status
        : typeof row.state === 'string'
          ? row.state
          : row.grantedAt === undefined
            ? ''
            : typeof row.withdrawnAt === 'string'
              ? 'WITHDRAWN'
              : 'GRANTED';
    if (!type || !status) return null;
    return { type, status };
  });
}

function readAllergies(value: unknown): { ok: boolean; items: readonly AllergyRow[] } {
  return rowList<AllergyRow>(value, (row) => {
    if (!isRecord(row)) return null;
    if (typeof row.substance !== 'string' || row.substance.length === 0) return null;
    return {
      substance: row.substance,
      severity: typeof row.severity === 'string' ? row.severity : null,
      status: typeof row.status === 'string' ? row.status : '',
      reaction: typeof row.reaction === 'string' ? row.reaction : null,
    };
  });
}

function readMedicalHistory(value: unknown): {
  ok: boolean;
  items: readonly MedicalHistoryRow[];
} {
  return rowList<MedicalHistoryRow>(value, (row) => {
    if (!isRecord(row)) return null;
    if (typeof row.category !== 'string' || typeof row.description !== 'string') return null;
    return {
      category: row.category,
      description: row.description,
      onsetDate: typeof row.onsetDate === 'string' ? row.onsetDate : null,
    };
  });
}

/**
 * Reads the master envelope `{ patient, sections }`.
 *
 * The export types this body as a plain `PatientResponseDto`; validation below is
 * the only thing between a drifted body and a banner a clinician trusts. `sections`
 * that come back as a non-array fail the whole response (fail closed), while each
 * array row is validated individually.
 */
export function extractPatientMaster(
  body: unknown,
): { ok: true; record: PatientMasterRecord } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  if (body.success !== true) return { ok: false };
  const data = body.data;
  if (!isRecord(data)) return { ok: false };

  const patient = readPatientRow(data.patient);
  if (!patient) return { ok: false };

  const sections = isRecord(data.sections) ? data.sections : {};
  // A missing `sections` block (or a section key) is a drifted body, not an
  // "empty record". Explicit empty arrays read as "no data recorded"; an absent
  // array cannot be trusted, so the whole envelope fails closed.
  const guardians = readGuardians(sections.guardians);
  const consents = readConsents(sections.consents);
  const allergies = readAllergies(sections.allergies);
  const medicalHistory = readMedicalHistory(sections.medicalHistory);
  if (!guardians.ok || !consents.ok || !allergies.ok || !medicalHistory.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    record: {
      patient,
      sections: {
        guardians: guardians.items,
        consents: consents.items,
        allergies: allergies.items,
        medicalHistory: medicalHistory.items,
      },
    },
  };
}

/** Reads a `{ items, meta }` page used by the timeline and access log endpoints. */
export function extractPatientPage(
  body: unknown,
): { ok: true; items: readonly unknown[]; total: number } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  if (body.success !== true) return { ok: false };
  const data = body.data;
  if (!isRecord(data)) return { ok: false };
  if (!Array.isArray(data.items)) return { ok: false };
  const meta = isRecord(data.meta) ? data.meta : {};
  const total = typeof meta.total === 'number' ? meta.total : data.items.length;
  return { ok: true, items: data.items, total };
}

/**
 * Reads a timeline entry as the clinical Timeline expects it.
 *
 * Timeline entries are raw rows (GAP-014). The export models `id`, `type`,
 * `title`, `occurredAt`, `actorId`, so `summary` (the older fixture field) is
 * accepted as well, and a row missing both the timestamp and the title fails
 * rather than rendering as an empty event.
 */
export function readTimelineEvent(
  row: unknown,
): { ok: true; event: TimelineEventRow } | { ok: false } {
  if (!isRecord(row)) return { ok: false };
  const timestamp =
    typeof row.occurredAt === 'string'
      ? row.occurredAt
      : typeof row.createdAt === 'string'
        ? row.createdAt
        : '';
  const summary =
    typeof row.summary === 'string' ? row.summary : typeof row.title === 'string' ? row.title : '';
  if (!timestamp || !summary) return { ok: false };
  const author = isRecord(row.author) ? row.author : null;
  return {
    ok: true,
    event: {
      id: typeof row.id === 'string' ? row.id : '',
      timestamp,
      summary,
      detail: typeof row.detail === 'string' ? row.detail : null,
      author: author && typeof author.displayName === 'string' ? author.displayName : null,
      type: typeof row.type === 'string' ? row.type : '',
    },
  };
}

export interface TimelineEventRow {
  readonly id: string;
  readonly timestamp: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly author: string | null;
  readonly type: string;
}

/** Shape every patient call rejects with, matching the query error contract. */
export interface PatientCallError {
  readonly code: string;
  readonly status: number;
}

/** Pulls the error code out of a non-2xx body the way the typed client does. */
function errorCodeFrom(body: unknown): string {
  if (!isRecord(body)) return 'INTERNAL_ERROR';
  const envelope = isRecord(body.error) ? body.error : body;
  return typeof envelope.code === 'string' ? envelope.code : 'INTERNAL_ERROR';
}

/**
 * Raw search against `GET /patients?q=…`.
 *
 * `q` is unmodelled in the export (GAP-012), so the typed client cannot express
 * it. This uses the facilities precedent: same-origin fetch (cookies ride along),
 * a drift-safe envelope check, then structural row validation.
 */
export async function fetchPatientSearch(
  q: string,
  signal?: AbortSignal,
): Promise<PatientListPage> {
  const needle = q.trim();
  const url = `${publicEnv.apiBasePath}/patients?q=${encodeURIComponent(needle)}&limit=25`;
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw { code: errorCodeFrom(body), status: response.status } satisfies PatientCallError;
  }
  const parsed = extractPatientList(body);
  if (!parsed.ok) {
    throw { code: 'INTERNAL_ERROR', status: 200 } satisfies PatientCallError;
  }
  return parsed.page;
}
