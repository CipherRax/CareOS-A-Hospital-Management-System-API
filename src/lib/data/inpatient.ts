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
