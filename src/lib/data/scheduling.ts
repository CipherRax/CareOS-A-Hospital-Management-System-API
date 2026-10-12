import { publicEnv } from '@/lib/env';

import {
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  stringArray,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Appointments, scheduling and the department waitlist (F3).
 *
 * The exported document mis-types every appointment/schedule 200 as its *request*
 * DTO — `GET /appointments` is typed `ListAppointmentsQueryDto`, `POST /appointments`
 * is typed `BookAppointmentDto`, `GET /schedules/slots` is typed `ListSlotsQueryDto`
 * — and leaves the list/slot queries unmodelled (`query: never`). The real bodies
 * come from `appointments.service.ts` and `schedules.service.ts`
 * (`{ items, meta }` pages, `{ appointment }`, `{ entry }`, `{ date, slots }`), so
 * every body below is validated structurally rather than trusted. This is the same
 * gap as the queue board (GAP-017), widened here; see GAP-018 for the two
 * appointment-specific issues (unjoined display names, no branch source).
 *
 * The lifecycle is fixed by the API's `appointment-flow.ts`:
 *
 *   BOOKED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED
 *
 * with CANCELLED / NO_SHOW as escapes and RESCHEDULED set only by the reschedule
 * flow. That graph is mirrored so the desk offers only legal moves; the server
 * still enforces it.
 */

export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_MODES = ['IN_PERSON', 'VIRTUAL'] as const;
export type AppointmentMode = (typeof APPOINTMENT_MODES)[number];

export const WAITLIST_STATUSES = [
  'WAITING',
  'OFFERED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'REMOVED',
] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const SLOT_STATUSES = ['AVAILABLE', 'FULL', 'PAST', 'UNAVAILABLE'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

/**
 * Legal appointment transitions, from the API's `APPOINTMENT_TRANSITIONS`. The
 * desk renders only these. `BOOKED` and `RESCHEDULED` are never a *target* — the
 * transition DTO excludes them — so they are absent from every list here.
 */
export const APPOINTMENT_TRANSITIONS: Record<string, readonly string[]> = {
  BOOKED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

/** Statuses an appointment can never leave (the API's `TERMINAL_APPOINTMENT_STATUSES`). */
export const TERMINAL_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);

/** Waitlist entries a receptionist can still action. */
export const ACTIONABLE_WAITLIST_STATUSES: ReadonlySet<string> = new Set(['WAITING', 'OFFERED']);

/**
 * The single branch this desk operates in.
 *
 * `BookAppointmentDto` and the slot query both *require* a `branchId`, but no
 * endpoint exposes the caller's permitted branches (`/auth/me` returns
 * `branch: { current: null }`, and departments carry no branch). Until a branch
 * source exists this slice is single-branch, matching the queue board's branch
 * constant. See GAP-018.
 */
export const SCHEDULING_BRANCH_ID = 'br_example_0001';

export interface AppointmentRow {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string;
  readonly departmentId: string;
  readonly branchId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly mode: string;
  readonly appointmentType: string | null;
  readonly reason: string | null;
  readonly status: string;
  readonly version: number;
}

export interface AppointmentPage {
  readonly items: readonly AppointmentRow[];
  readonly total: number;
}

export interface WaitlistEntryRow {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string | null;
  readonly departmentId: string;
  readonly branchId: string;
  readonly status: string;
  readonly preferredDate: string | null;
  readonly notes: string | null;
  readonly offeredStartAt: string | null;
  readonly createdAt: string | null;
}

export interface WaitlistPage {
  readonly items: readonly WaitlistEntryRow[];
  readonly total: number;
}

export interface ProviderOption {
  readonly id: string;
  readonly name: string;
  readonly bookable: boolean;
  readonly specialization: string | null;
  readonly professionalTitle: string | null;
  readonly departmentIds: readonly string[];
  readonly branchIds: readonly string[];
}

export interface SlotRow {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number;
  readonly booked: number;
  readonly remaining: number;
  readonly status: string;
}

export interface SlotDay {
  readonly date: string | null;
  readonly slots: readonly SlotRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one serialized appointment; returns null when the row cannot be one. */
export function readAppointment(value: unknown): AppointmentRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.startsAt !== 'string') return null;
  if (typeof value.status !== 'string') return null;
  return {
    id: value.id,
    patientId: typeof value.patientId === 'string' ? value.patientId : '',
    providerId: typeof value.providerId === 'string' ? value.providerId : '',
    departmentId: typeof value.departmentId === 'string' ? value.departmentId : '',
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    startsAt: value.startsAt,
    endsAt: typeof value.endsAt === 'string' ? value.endsAt : value.startsAt,
    mode: typeof value.mode === 'string' ? value.mode : 'IN_PERSON',
    appointmentType: nullableString(value.appointmentType),
    reason: nullableString(value.reason),
    status: value.status,
    version: typeof value.version === 'number' ? value.version : 0,
  };
}

/**
 * Reads an appointment page from the unwrapped envelope: `data` is the array of
 * rows and `meta` the pagination sibling. An empty array is an empty day.
 */
export function extractAppointmentPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: AppointmentPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readAppointment);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly AppointmentRow[], total } };
}

/** Reads one serialized waitlist entry; returns null when the row is unusable. */
export function readWaitlistEntry(value: unknown): WaitlistEntryRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.status !== 'string') return null;
  return {
    id: value.id,
    patientId: typeof value.patientId === 'string' ? value.patientId : '',
    providerId: nullableString(value.providerId),
    departmentId: typeof value.departmentId === 'string' ? value.departmentId : '',
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    status: value.status,
    preferredDate: nullableString(value.preferredDate),
    notes: nullableString(value.notes),
    offeredStartAt: nullableString(value.offeredStartAt),
    createdAt: nullableString(value.createdAt),
  };
}

export function extractWaitlistPage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: WaitlistPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readWaitlistEntry);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly WaitlistEntryRow[], total } };
}

/**
 * Reads the provider directory (`{ items, meta }`). The export leaves `/providers`
 * unmodelled, so a row that is not a named, id'd provider is dropped rather than
 * becoming a blank option in the booking picker.
 */
export function extractProviderPage(
  data: unknown,
): { ok: true; providers: readonly ProviderOption[] } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const providers = data.flatMap((value): ProviderOption[] => {
    if (!isRecord(value)) return [];
    if (typeof value.id !== 'string' || typeof value.name !== 'string' || !value.name) return [];
    return [
      {
        id: value.id,
        name: value.name,
        bookable: typeof value.bookable === 'boolean' ? value.bookable : true,
        specialization: nullableString(value.specialization),
        professionalTitle: nullableString(value.professionalTitle),
        departmentIds: stringArray(value.departmentIds),
        branchIds: stringArray(value.branchIds),
      },
    ];
  });
  return { ok: true, providers };
}

/** Reads one slot; returns null when the slot has no usable start. */
export function readSlot(value: unknown): SlotRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.startsAt !== 'string' || typeof value.endsAt !== 'string') return null;
  const capacity = typeof value.capacity === 'number' ? value.capacity : 0;
  const booked = typeof value.booked === 'number' ? value.booked : 0;
  return {
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    capacity,
    booked,
    remaining: typeof value.remaining === 'number' ? value.remaining : Math.max(0, capacity - booked),
    status: typeof value.status === 'string' ? value.status : 'UNAVAILABLE',
  };
}

/** Reads the slot day (`{ date, slots }`). A missing `slots` array is a broken body. */
export function extractSlotDay(payload: unknown): { ok: true; day: SlotDay } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (!Array.isArray(payload.slots)) return { ok: false };
  const slots = payload.slots.map(readSlot);
  if (slots.some((slot) => slot === null)) return { ok: false };
  return {
    ok: true,
    day: {
      date: nullableString(payload.date),
      slots: slots as readonly SlotRow[],
    },
  };
}

/** Reads the two timestamps an appointment produces on a successful mutation. */
export function extractAppointmentRecord(
  payload: unknown,
): { ok: true; appointment: AppointmentRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const appointment = readAppointment(payload.appointment);
  return appointment ? { ok: true, appointment } : { ok: false };
}

export interface WaitlistEntryRecord {
  readonly id: string;
  readonly status: string;
  readonly patientId: string;
  readonly departmentId: string;
}

/** Reads the `{ entry }` body a join/leave answers with. */
export function extractWaitlistRecord(
  payload: unknown,
): { ok: true; entry: WaitlistEntryRecord } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const entry = readWaitlistEntry(payload.entry);
  if (!entry) return { ok: false };
  return {
    ok: true,
    entry: {
      id: entry.id,
      status: entry.status,
      patientId: entry.patientId,
      departmentId: entry.departmentId,
    },
  };
}

/** Appointment rows ordered by start time, earliest first. */
export function byStartTime(rows: readonly AppointmentRow[]): AppointmentRow[] {
  return [...rows].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * The business-day key (`YYYY-MM-DD`) a timestamp falls in.
 *
 * Business days are UTC-based, matching the API's `startOfBusinessDay` — the
 * schedules module generates slots on the UTC clock so the fleet is deterministic.
 * A local-time key would put a booking made just after midnight UTC in the wrong
 * day's book.
 */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** The inclusive ISO range that covers a `YYYY-MM-DD` business day (UTC). */
export function dayRange(dateISO: string): { dateFrom: string; dateTo: string } {
  const [year = 0, month = 1, day = 1] = dateISO.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

/** Today as `YYYY-MM-DD` on the UTC business-day clock, the desk's default filter. */
export function todayISO(now: Date = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-${day}`;
}

/** Shape every scheduling raw call rejects with, matching the query error contract. */
export type SchedulingCallError = EnvelopeCallError;

export interface AppointmentQuery {
  readonly departmentId?: string;
  readonly providerId?: string;
  readonly status?: string;
  /** A `YYYY-MM-DD` day; the reader widens it to an inclusive local-day range. */
  readonly date?: string;
}

/** Raw day-book read against `GET /appointments` (unmodelled query, mis-typed body). */
export async function fetchAppointments(
  query: AppointmentQuery = {},
  signal?: AbortSignal,
): Promise<AppointmentPage> {
  const range: { dateFrom?: string; dateTo?: string } = query.date ? dayRange(query.date) : {};
  const url = `${publicEnv.apiBasePath}/appointments${queryString({
    departmentId: query.departmentId,
    providerId: query.providerId,
    status: query.status,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    limit: '100',
  })}`;
  return readEnvelope<AppointmentPage>(
    url,
    (data, meta) => {
      const page = extractAppointmentPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw waitlist read against `GET /appointments/waitlist/entries`. */
export async function fetchWaitlist(
  query: { departmentId?: string; status?: string } = {},
  signal?: AbortSignal,
): Promise<WaitlistPage> {
  const url = `${publicEnv.apiBasePath}/appointments/waitlist/entries${queryString({
    departmentId: query.departmentId,
    status: query.status,
    limit: '100',
  })}`;
  const parsed = await readEnvelope<WaitlistPage>(
    url,
    (data, meta) => {
      const page = extractWaitlistPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
  return parsed;
}

/** Raw provider directory read against `GET /providers`. */
export async function fetchProviders(
  query: { departmentId?: string } = {},
  signal?: AbortSignal,
): Promise<readonly ProviderOption[]> {
  const url = `${publicEnv.apiBasePath}/providers${queryString({
    departmentId: query.departmentId,
    bookableOnly: 'true',
    limit: '100',
  })}`;
  return readEnvelope<readonly ProviderOption[]>(
    url,
    (data) => {
      const page = extractProviderPage(data);
      return page.ok ? { ok: true, value: page.providers } : { ok: false };
    },
    signal,
  );
}

export interface SlotQuery {
  readonly providerId: string;
  readonly departmentId: string;
  /** A `YYYY-MM-DD` day. */
  readonly date: string;
}

/** Raw slot read against `GET /schedules/slots`. Past slots are excluded. */
export async function fetchSlots(query: SlotQuery, signal?: AbortSignal): Promise<SlotDay> {
  const url = `${publicEnv.apiBasePath}/schedules/slots${queryString({
    providerId: query.providerId,
    departmentId: query.departmentId,
    branchId: SCHEDULING_BRANCH_ID,
    date: query.date,
    includePast: 'false',
  })}`;
  const parsed = await readEnvelope<SlotDay>(
    url,
    (data) => {
      const day = extractSlotDay(data);
      return day.ok ? { ok: true, value: day.day } : { ok: false };
    },
    signal,
  );
  return parsed;
}
