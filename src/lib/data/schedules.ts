import { publicEnv } from '@/lib/env';
import { SCHEDULING_BRANCH_ID } from '@/lib/data/scheduling';

import {
  isRecord,
  nullableString,
  pageTotal,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Schedule administration (F3): weekly templates and per-date overrides.
 *
 * The exported document mis-types every schedule 200 as the operation's request
 * DTO — `GET /schedules/templates` is typed `ListSchedulesQueryDto` — and leaves
 * the list query unmodelled (`query: never`), so the template list rides a raw
 * fetch and is validated structurally. Same defect as the queue and appointments
 * (GAP-017), widened here.
 *
 * `GET /schedules/templates` reads a page envelope (`{ data: [...], meta }`);
 * create/update return `{ schedule }` / `{ override }`; delete answers 204 with
 * no body.
 *
 * **Overrides cannot be listed.** There is no `GET /schedules/overrides`
 * endpoint — only create, update and delete — so the admin screen can create and
 * remove an override but cannot enumerate the ones that already exist. That is a
 * contract gap, tracked as GAP-019; the screen says so rather than pretending a
 * list it did not fetch is complete.
 *
 * `dayOfWeek` follows the API's workweek (0=MONDAY .. 6=SUNDAY), not
 * `Date.getDay()`; the slot windows are minute offsets from the UTC business day.
 */

export const SCHEDULE_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];

export const OVERRIDE_TYPES = ['WORKING', 'LEAVE', 'HOLIDAY', 'BLOCKED'] as const;
export type OverrideType = (typeof OVERRIDE_TYPES)[number];

export interface ScheduleTemplateRow {
  readonly id: string;
  readonly providerId: string;
  readonly branchId: string;
  readonly departmentId: string;
  readonly dayOfWeek: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly slotDurationMinutes: number;
  readonly capacity: number;
  readonly isAvailable: boolean;
  readonly note: string | null;
}

export interface ScheduleOverrideRow {
  readonly id: string;
  readonly providerId: string;
  readonly branchId: string;
  readonly departmentId: string;
  readonly date: string;
  readonly type: string;
  readonly startMinutes: number | null;
  readonly endMinutes: number | null;
  readonly slotDurationMinutes: number | null;
  readonly capacity: number | null;
  readonly note: string | null;
}

export interface TemplatePage {
  readonly items: readonly ScheduleTemplateRow[];
  readonly total: number;
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads one weekly template; null when the row cannot describe a window. */
export function readTemplate(value: unknown): ScheduleTemplateRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.providerId !== 'string') return null;
  if (typeof value.dayOfWeek !== 'number') return null;
  if (typeof value.startMinutes !== 'number' || typeof value.endMinutes !== 'number') return null;
  return {
    id: value.id,
    providerId: value.providerId,
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    departmentId: typeof value.departmentId === 'string' ? value.departmentId : '',
    dayOfWeek: value.dayOfWeek,
    startMinutes: value.startMinutes,
    endMinutes: value.endMinutes,
    slotDurationMinutes: intOr(value.slotDurationMinutes, 30),
    capacity: intOr(value.capacity, 1),
    isAvailable: typeof value.isAvailable === 'boolean' ? value.isAvailable : true,
    note: nullableString(value.note),
  };
}

/** Reads the `{ schedule }` body a create/update answers with. */
export function extractTemplateRecord(
  payload: unknown,
): { ok: true; template: ScheduleTemplateRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const template = readTemplate(payload.schedule);
  return template ? { ok: true, template } : { ok: false };
}

/** Reads a template page from the unwrapped envelope (`data` array + `meta`). */
export function extractTemplatePage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: TemplatePage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readTemplate);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly ScheduleTemplateRow[], total } };
}

/** Reads one override; null when the row cannot describe a dated exception. */
export function readOverride(value: unknown): ScheduleOverrideRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.providerId !== 'string') return null;
  if (typeof value.date !== 'string') return null;
  if (typeof value.type !== 'string') return null;
  return {
    id: value.id,
    providerId: value.providerId,
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    departmentId: typeof value.departmentId === 'string' ? value.departmentId : '',
    date: value.date,
    type: value.type,
    startMinutes: nullableInt(value.startMinutes),
    endMinutes: nullableInt(value.endMinutes),
    slotDurationMinutes: nullableInt(value.slotDurationMinutes),
    capacity: nullableInt(value.capacity),
    note: nullableString(value.note),
  };
}

/** Reads the `{ override }` body a create/update answers with. */
export function extractOverrideRecord(
  payload: unknown,
): { ok: true; override: ScheduleOverrideRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const override = readOverride(payload.override);
  return override ? { ok: true, override } : { ok: false };
}

/** Templates ordered by day, then start time — how a week reads on a screen. */
export function byDayAndTime(rows: readonly ScheduleTemplateRow[]): ScheduleTemplateRow[] {
  return [...rows].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startMinutes - b.startMinutes;
  });
}

/** Formats a minute-offset window boundary as `HH:MM` on the UTC clock. */
export function minutesToTime(minutes: number): string {
  const wrapped = Math.max(0, Math.min(1440, Math.round(minutes)));
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Parses `HH:MM` (or `HH:MM:SS`) into a minute offset; null when unparseable. */
export function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 24 || mins > 59) return null;
  const total = hours * 60 + mins;
  return total > 1440 ? null : total;
}

/** The `YYYY-MM-DD` key of an override's date, from its ISO timestamp. */
export function overrideDateKey(date: string): string {
  return date.slice(0, 10);
}

export interface CreateTemplateInput {
  readonly providerId: string;
  readonly branchId: string;
  readonly departmentId: string;
  readonly dayOfWeek: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly slotDurationMinutes: number;
  readonly capacity: number;
  readonly isAvailable: boolean;
  readonly note?: string;
}

export interface CreateOverrideInput {
  readonly providerId: string;
  readonly branchId: string;
  readonly departmentId: string;
  readonly date: string;
  readonly type: OverrideType;
  readonly startMinutes?: number;
  readonly endMinutes?: number;
  readonly slotDurationMinutes?: number;
  readonly capacity?: number;
  readonly note?: string;
}

/** Shape every schedules raw call rejects with, matching the query error contract. */
export type SchedulesCallError = EnvelopeCallError;

export interface TemplateQuery {
  readonly providerId?: string;
  readonly departmentId?: string;
}

/** Raw template read against `GET /schedules/templates` (unmodelled query). */
export async function fetchTemplates(
  query: TemplateQuery = {},
  signal?: AbortSignal,
): Promise<TemplatePage> {
  const search = new URLSearchParams();
  if (query.providerId) search.set('providerId', query.providerId);
  if (query.departmentId) search.set('departmentId', query.departmentId);
  search.set('limit', '100');
  const url = `${publicEnv.apiBasePath}/schedules/templates?${search.toString()}`;
  return readEnvelope<TemplatePage>(
    url,
    (data, meta) => {
      const page = extractTemplatePage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** The single branch this admin surface manages, matching the desk (GAP-018). */
export const SCHEDULES_BRANCH_ID = SCHEDULING_BRANCH_ID;
