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
 * Inpatient (F8 — ward board and bed management).
 *
 * `GET /wards` types its 200 as the request DTO while the service answers a
 * `PageResult`, and `GET /wards/{id}` types the bare entity while the service
 * answers `{ ward }` (GAP-020 family). Both therefore ride the raw-fetch path and
 * are validated structurally: a ward, its rooms and its beds are one nested
 * shape, and a body that drifts fails closed rather than rendering an empty
 * board (which on a ward board would read as "no beds" — a dangerous lie).
 *
 * `OCCUPIED` is assignment-driven — the service sets it when a patient is
 * admitted and clears it on transfer or discharge — so `MANUAL_BED_STATUSES`
 * lists only the states an operator may set directly.
 */

export const BED_STATUSES = [
  'AVAILABLE',
  'OCCUPIED',
  'RESERVED',
  'CLEANING',
  'MAINTENANCE',
  'BLOCKED',
] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

/** Statuses an operator may set directly; `OCCUPIED` is assignment-driven. */
export const MANUAL_BED_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'CLEANING',
  'MAINTENANCE',
  'BLOCKED',
] as const;
export type ManualBedStatus = (typeof MANUAL_BED_STATUSES)[number];

/**
 * The branch wards are created in. The app has no branch picker yet (the session
 * reports `branch.current: null`), so creation posts to the EXAMPLE branch the
 * rest of the desks use — the same workaround as scheduling and billing
 * (GAP-018). A real deployment reads this from the session.
 */
export const INPATIENT_BRANCH_ID = 'br_example_0001';

export interface BedRow {
  readonly id: string;
  readonly roomId: string;
  readonly bedNumber: string;
  readonly status: BedStatus;
  readonly version: number;
}

export interface RoomRow {
  readonly id: string;
  readonly wardId: string;
  readonly name: string;
  readonly description: string | null;
  readonly beds: readonly BedRow[];
}

export interface WardRow {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly name: string;
  readonly code: string | null;
  readonly floor: string | null;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly rooms: readonly RoomRow[];
}

export interface WardPage {
  readonly rows: readonly WardRow[];
  readonly total: number;
}

export interface WardQuery {
  readonly branchId?: string;
  readonly active?: boolean;
  readonly page?: number;
  readonly limit?: number;
}

export interface CreateWardInput {
  readonly name: string;
  readonly code?: string;
  readonly floor?: string;
  readonly description?: string;
}

export interface CreateRoomInput {
  readonly wardId: string;
  readonly name: string;
  readonly description?: string;
}

export interface CreateBedInput {
  readonly roomId: string;
  readonly bedNumber: string;
}

export type InpatientCallError = EnvelopeCallError;

function readBed(value: unknown): BedRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.roomId !== 'string') return null;
  if (typeof value.bedNumber !== 'string' || typeof value.status !== 'string') return null;
  if (!BED_STATUSES.includes(value.status as BedStatus)) return null;
  return {
    id: value.id,
    roomId: value.roomId,
    bedNumber: value.bedNumber,
    status: value.status as BedStatus,
    version: typeof value.version === 'number' ? value.version : 0,
  };
}

function readRoom(value: unknown): RoomRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.wardId !== 'string') return null;
  if (typeof value.name !== 'string') return null;
  const rawBeds = Array.isArray(value.beds) ? value.beds : [];
  const beds = rawBeds.map(readBed);
  if (beds.some((bed) => bed === null)) return null;
  return {
    id: value.id,
    wardId: value.wardId,
    name: value.name,
    description: nullableString(value.description),
    beds: beds as readonly BedRow[],
  };
}

/** Reads one serialized ward; returns null when a required field has drifted. */
export function readWard(value: unknown): WardRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  if (typeof value.branchId !== 'string') return null;
  const rawRooms = Array.isArray(value.rooms) ? value.rooms : [];
  const rooms = rawRooms.map(readRoom);
  if (rooms.some((room) => room === null)) return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    branchId: value.branchId,
    name: value.name,
    code: nullableString(value.code),
    floor: nullableString(value.floor),
    description: nullableString(value.description),
    isActive: value.isActive !== false,
    rooms: rooms as readonly RoomRow[],
  };
}

/** Reads the ward page from the unwrapped `data` plus the sibling `meta`. */
export function extractWardPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: WardPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readWard);
  if (rows.some((row) => row === null)) return { ok: false };
  return { ok: true, page: { rows: rows as readonly WardRow[], total: pageTotal(meta, rows.length) } };
}

/** Reads a single-ward body: the service answers `{ ward }`. */
export function extractWardRecord(
  payload: unknown,
): { ok: true; ward: WardRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const ward = readWard(payload.ward);
  return ward ? { ok: true, ward } : { ok: false };
}

/** Reads a single-bed body: create and status writes answer `{ bed }`. */
export function extractBedRecord(payload: unknown): { ok: true; bed: BedRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const bed = readBed(payload.bed);
  return bed ? { ok: true, bed } : { ok: false };
}

/** Reads a single-room body: room creation answers `{ room }`. */
export function extractRoomRecord(payload: unknown): { ok: true; room: RoomRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (!isRecord(payload.room)) return { ok: false };
  const room = readRoom(payload.room);
  return room ? { ok: true, room } : { ok: false };
}

/** Raw read against `GET /wards?{filters}` (GAP-020: the 200 is the query DTO). */
export async function fetchWards(
  query: WardQuery = {},
  signal?: AbortSignal,
): Promise<WardPage> {
  const suffix = queryString({
    branchId: query.branchId,
    active: query.active !== undefined ? String(query.active) : undefined,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/wards${suffix}`;
  return readEnvelope<WardPage>(
    url,
    (data, meta) => {
      const page = extractWardPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /wards/{id}` (the service answers `{ ward }`). */
export async function fetchWard(id: string, signal?: AbortSignal): Promise<WardRow> {
  const url = `${publicEnv.apiBasePath}/wards/${encodeURIComponent(id)}`;
  return readEnvelope<WardRow>(
    url,
    (data) => {
      const parsed = extractWardRecord(data);
      return parsed.ok ? { ok: true, value: parsed.ward } : { ok: false };
    },
    signal,
  );
}

// --- admissions (F8 slice 2) -----------------------------------------------

export const ADMISSION_SOURCES = [
  'EMERGENCY',
  'OUTPATIENT_CLINIC',
  'REFERRAL',
  'PLANNED',
  'DIRECT',
] as const;
export type AdmissionSource = (typeof ADMISSION_SOURCES)[number];

export const ADMISSION_STATUSES = ['ADMITTED', 'DISCHARGED'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export interface BedAssignmentRow {
  readonly id: string;
  readonly bedId: string;
  readonly assignedAt: string;
  readonly releasedById: string | null;
  readonly releasedAt: string | null;
  readonly reason: string | null;
}

export interface DischargeFollowUp {
  readonly type: string;
  readonly date: string | null;
  readonly notes: string | null;
}

export interface DischargeRow {
  readonly id: string;
  readonly admissionId: string;
  readonly dischargedAt: string;
  readonly summary: string | null;
  readonly instructions: string | null;
  readonly followUp: DischargeFollowUp | null;
  readonly hasOutstandingBilling: boolean;
}

export interface AdmissionRow {
  readonly id: string;
  readonly admissionNumber: string;
  readonly patientId: string;
  readonly branchId: string;
  readonly departmentId: string | null;
  readonly encounterId: string | null;
  readonly source: AdmissionSource;
  readonly status: AdmissionStatus;
  readonly admittedById: string | null;
  readonly admittedAt: string;
  readonly expectedDischargeAt: string | null;
  readonly provisionalDiagnosis: string | null;
  readonly version: number;
  readonly assignments: readonly BedAssignmentRow[];
  readonly discharge: DischargeRow | null;
}

export interface AdmissionPage {
  readonly rows: readonly AdmissionRow[];
  readonly total: number;
}

export interface AdmissionQuery {
  readonly patientId?: string;
  readonly branchId?: string;
  readonly status?: AdmissionStatus;
  readonly page?: number;
  readonly limit?: number;
}

/**
 * Admit a patient. The service assigns the source (`OUTPATIENT_CLINIC` for this
 * desk; the emergency desk admits with `EMERGENCY` in the same transaction), so
 * the client cannot choose it. `branchId` is the EXAMPLE branch (GAP-018).
 */
export interface CreateAdmissionInput {
  readonly patientId: string;
  readonly bedId: string;
  readonly branchId?: string;
  readonly departmentId?: string;
  readonly encounterId?: string;
  readonly provisionalDiagnosis?: string;
  readonly expectedDischargeAt?: string;
}

export interface TransferAdmissionInput {
  readonly id: string;
  readonly toBedId: string;
  readonly reason?: string;
}

export interface DischargeAdmissionInput {
  readonly id: string;
  readonly summary?: string;
  readonly instructions?: string;
  readonly followUp?: { type: string; date?: string; notes?: string };
  readonly hasOutstandingBilling?: boolean;
  readonly dischargedAt?: string;
}

/** The admission's current (unreleased) bed assignment, if any. */
export function activeAssignment(admission: AdmissionRow): BedAssignmentRow | null {
  return admission.assignments.find((assignment) => assignment.releasedAt === null) ?? null;
}

/** A bed flattened out of the ward tree, with the names needed to label it. */
export interface BedOption {
  readonly id: string;
  readonly wardName: string;
  readonly roomName: string;
  readonly bedNumber: string;
  readonly status: BedStatus;
}

/** Flattens the nested ward tree into a flat bed list for lookups and pickers. */
export function collectBeds(wards: readonly WardRow[]): readonly BedOption[] {
  return wards.flatMap((ward) =>
    ward.rooms.flatMap((room) =>
      room.beds.map((bed) => ({
        id: bed.id,
        wardName: ward.name,
        roomName: room.name,
        bedNumber: bed.bedNumber,
        status: bed.status,
      })),
    ),
  );
}

function readFollowUp(value: unknown): DischargeFollowUp | null {
  if (!isRecord(value)) return null;
  if (typeof value.type !== 'string') return null;
  return {
    type: value.type,
    date: nullableString(value.date),
    notes: nullableString(value.notes),
  };
}

function readDischarge(value: unknown): DischargeRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.admissionId !== 'string') return null;
  if (typeof value.dischargedAt !== 'string') return null;
  return {
    id: value.id,
    admissionId: value.admissionId,
    dischargedAt: value.dischargedAt,
    summary: nullableString(value.summary),
    instructions: nullableString(value.instructions),
    followUp: readFollowUp(value.followUp),
    hasOutstandingBilling: value.hasOutstandingBilling === true,
  };
}

function readAssignment(value: unknown): BedAssignmentRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.bedId !== 'string') return null;
  if (typeof value.assignedAt !== 'string') return null;
  return {
    id: value.id,
    bedId: value.bedId,
    assignedAt: value.assignedAt,
    releasedById: nullableString(value.releasedById),
    releasedAt: nullableString(value.releasedAt),
    reason: nullableString(value.reason),
  };
}

/** Reads one serialized admission; returns null when a required field has drifted. */
export function readAdmission(value: unknown): AdmissionRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.admissionNumber !== 'string') return null;
  if (typeof value.patientId !== 'string' || typeof value.branchId !== 'string') return null;
  if (typeof value.status !== 'string' || !ADMISSION_STATUSES.includes(value.status as AdmissionStatus)) {
    return null;
  }
  if (typeof value.source !== 'string' || !ADMISSION_SOURCES.includes(value.source as AdmissionSource)) {
    return null;
  }
  if (typeof value.admittedAt !== 'string') return null;

  const rawAssignments = Array.isArray(value.assignments) ? value.assignments : [];
  const assignments = rawAssignments.map(readAssignment);
  if (assignments.some((assignment) => assignment === null)) return null;

  const discharge = value.discharge == null ? null : readDischarge(value.discharge);
  if (value.discharge != null && discharge === null) return null;

  return {
    id: value.id,
    admissionNumber: value.admissionNumber,
    patientId: value.patientId,
    branchId: value.branchId,
    departmentId: nullableString(value.departmentId),
    encounterId: nullableString(value.encounterId),
    source: value.source as AdmissionSource,
    status: value.status as AdmissionStatus,
    admittedById: nullableString(value.admittedById),
    admittedAt: value.admittedAt,
    expectedDischargeAt: nullableString(value.expectedDischargeAt),
    provisionalDiagnosis: nullableString(value.provisionalDiagnosis),
    version: typeof value.version === 'number' ? value.version : 0,
    assignments: assignments as readonly BedAssignmentRow[],
    discharge,
  };
}

/** Reads the admission page from the unwrapped `data` plus the sibling `meta`. */
export function extractAdmissionPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: AdmissionPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readAdmission);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly AdmissionRow[], total: pageTotal(meta, rows.length) },
  };
}

/** Reads a single-admission body: reads and writes answer `{ admission }`. */
export function extractAdmissionRecord(
  payload: unknown,
): { ok: true; admission: AdmissionRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const admission = readAdmission(payload.admission);
  return admission ? { ok: true, admission } : { ok: false };
}

/** Raw read against `GET /admissions?{filters}` (GAP-020: the 200 is the query DTO). */
export async function fetchAdmissions(
  query: AdmissionQuery = {},
  signal?: AbortSignal,
): Promise<AdmissionPage> {
  const suffix = queryString({
    patientId: query.patientId,
    branchId: query.branchId,
    status: query.status,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/admissions${suffix}`;
  return readEnvelope<AdmissionPage>(
    url,
    (data, meta) => {
      const page = extractAdmissionPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /admissions/{id}` (the service answers `{ admission }`). */
export async function fetchAdmission(id: string, signal?: AbortSignal): Promise<AdmissionRow> {
  const url = `${publicEnv.apiBasePath}/admissions/${encodeURIComponent(id)}`;
  return readEnvelope<AdmissionRow>(
    url,
    (data) => {
      const parsed = extractAdmissionRecord(data);
      return parsed.ok ? { ok: true, value: parsed.admission } : { ok: false };
    },
    signal,
  );
}
