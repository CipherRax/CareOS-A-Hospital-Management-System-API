import { publicEnv } from '@/lib/env';

/**
 * Queue contract readers (F3).
 *
 * The exported document mis-types every queue 200 as its *request* DTO —
 * `GET /queue` returns `ListQueueQueryDto`, `POST /queue/walk-ins/register`
 * returns `RegisterWalkInDto`, and so on (GAP-017). The real bodies come from
 * `queue.service.ts` (`{ items, meta }` pages, `{ stats }`, the walk-in receipt),
 * so each is validated here rather than trusted.
 *
 * The queue flow itself is fixed by the API's `queue-flow.ts`: a ticket walks
 * WAITING → CALLED → IN_SERVICE → COMPLETED, and NO_SHOW / ABANDONED / CANCELLED
 * / TRANSFERRED are the exits. That graph is mirrored so the board offers only
 * legal moves; the server still enforces it.
 */

export const QUEUE_STATUSES = [
  'WAITING',
  'CALLED',
  'IN_SERVICE',
  'COMPLETED',
  'NO_SHOW',
  'ABANDONED',
  'CANCELLED',
  'TRANSFERRED',
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const OPERATIONAL_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type OperationalPriority = (typeof OPERATIONAL_PRIORITIES)[number];

/** Statuses that still consume the patient's turn (still in front of the desk). */
export const ACTIVE_QUEUE_STATUSES: ReadonlySet<string> = new Set([
  'WAITING',
  'CALLED',
  'IN_SERVICE',
]);

/**
 * Legal queue transitions, from the API's `QUEUE_TRANSITIONS`. The board renders
 * only these, so an illegal move is not offered and then rejected.
 */
export const QUEUE_TRANSITIONS: Record<string, readonly QueueStatus[]> = {
  WAITING: ['CALLED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED'],
  CALLED: ['IN_SERVICE', 'WAITING', 'NO_SHOW', 'CANCELLED', 'TRANSFERRED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED', 'TRANSFERRED'],
  COMPLETED: [],
  NO_SHOW: [],
  ABANDONED: [],
  CANCELLED: [],
  TRANSFERRED: [],
};

/** Higher rank = seen sooner. Mirrors the API's `PRIORITY_RANK`. */
export const PRIORITY_RANK: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export interface QueueEntryRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly patientId: string;
  /** The name the API joined for the row (`"First Last"`), or null. */
  readonly patient: string | null;
  readonly visitId: string;
  readonly departmentId: string;
  readonly branchId: string;
  readonly status: string;
  readonly operationalPriority: string;
  readonly enteredAt: string | null;
  readonly calledAt: string | null;
  readonly serviceStartedAt: string | null;
  readonly completedAt: string | null;
  readonly note: string | null;
}

export interface QueuePage {
  readonly items: readonly QueueEntryRow[];
  readonly total: number;
}

export interface QueueStats {
  readonly avgCallWaitMinutes: number | null;
  readonly avgServiceMinutes: number | null;
  readonly abandonmentRate: number | null;
  readonly currentlyWaiting: number;
}

export interface RegisteredWalkIn {
  readonly ticketNumber: string;
  readonly visitId: string;
  readonly position: number | null;
  readonly status: string;
}

export interface DepartmentOption {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly active: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Reads one queue row; returns null when the row cannot be a ticket. */
export function readQueueEntry(value: unknown): QueueEntryRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.ticketNumber !== 'string') return null;
  if (typeof value.status !== 'string') return null;
  return {
    id: value.id,
    ticketNumber: value.ticketNumber,
    patientId: typeof value.patientId === 'string' ? value.patientId : '',
    patient: nullableString(value.patient),
    visitId: typeof value.visitId === 'string' ? value.visitId : '',
    departmentId: typeof value.departmentId === 'string' ? value.departmentId : '',
    branchId: typeof value.branchId === 'string' ? value.branchId : '',
    status: value.status,
    operationalPriority:
      typeof value.operationalPriority === 'string' ? value.operationalPriority : 'NORMAL',
    enteredAt: nullableString(value.enteredAt),
    calledAt: nullableString(value.calledAt),
    serviceStartedAt: nullableString(value.serviceStartedAt),
    completedAt: nullableString(value.completedAt),
    note: nullableString(value.note),
  };
}

/**
 * Reads the queue page payload (`{ items, meta }`). The typed client has already
 * unwrapped the success envelope. A non-array `items` is a broken body; a
 * genuinely empty array is an empty board.
 */
export function extractQueuePage(
  payload: unknown,
): { ok: true; page: QueuePage } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (!Array.isArray(payload.items)) return { ok: false };
  const items = payload.items.map(readQueueEntry);
  if (items.some((item) => item === null)) return { ok: false };
  const meta = isRecord(payload.meta) ? payload.meta : {};
  const total = typeof meta.total === 'number' ? meta.total : items.length;
  return { ok: true, page: { items: items as readonly QueueEntryRow[], total } };
}

/** Reads `{ stats }` from the metrics endpoint, defaulting unknown numbers to null. */
export function extractQueueStats(payload: unknown): { ok: true; stats: QueueStats } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (!isRecord(payload.stats)) return { ok: false };
  const stats = payload.stats;
  return {
    ok: true,
    stats: {
      avgCallWaitMinutes: typeof stats.avgCallWaitMinutes === 'number' ? stats.avgCallWaitMinutes : null,
      avgServiceMinutes: typeof stats.avgServiceMinutes === 'number' ? stats.avgServiceMinutes : null,
      abandonmentRate: typeof stats.abandonmentRate === 'number' ? stats.abandonmentRate : null,
      currentlyWaiting: typeof stats.currentlyWaiting === 'number' ? stats.currentlyWaiting : 0,
    },
  };
}

/** Reads the walk-in receipt (`{ ticketNumber, visitId, position, status }`). */
export function extractRegisteredWalkIn(
  payload: unknown,
): { ok: true; receipt: RegisteredWalkIn } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (typeof payload.ticketNumber !== 'string' || payload.ticketNumber.length === 0) {
    return { ok: false };
  }
  return {
    ok: true,
    receipt: {
      ticketNumber: payload.ticketNumber,
      visitId: typeof payload.visitId === 'string' ? payload.visitId : '',
      position: typeof payload.position === 'number' ? payload.position : null,
      status: typeof payload.status === 'string' ? payload.status : 'WAITING',
    },
  };
}

/**
 * Reads the department list (`{ departments, meta }` — note `departments`, not
 * `items`). The export types this one correctly (`DepartmentListResponseDto`),
 * but the read stays structural so a drifted body does not become a picker with
 * a blank first option.
 */
export function extractDepartmentList(
  payload: unknown,
): { ok: true; departments: readonly DepartmentOption[] } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (!Array.isArray(payload.departments)) return { ok: false };
  const departments = payload.departments.flatMap((value): DepartmentOption[] => {
    if (!isRecord(value)) return [];
    if (typeof value.id !== 'string' || typeof value.name !== 'string') return [];
    return [
      {
        id: value.id,
        name: value.name,
        code: nullableString(value.code),
        active: typeof value.active === 'boolean' ? value.active : true,
      },
    ];
  });
  return { ok: true, departments };
}

/**
 * The board's order: active tickets sorted by priority (urgent first), then by
 * how long they have waited, then by ticket number. Mirrors the API's
 * `queueSortKey` so the board agrees with the waiting-room display.
 */
export function boardOrder(entries: readonly QueueEntryRow[]): QueueEntryRow[] {
  return [...entries].sort((a, b) => {
    const rank = (PRIORITY_RANK[b.operationalPriority] ?? 0) - (PRIORITY_RANK[a.operationalPriority] ?? 0);
    if (rank !== 0) return rank;
    const at = a.enteredAt ? Date.parse(a.enteredAt) : 0;
    const bt = b.enteredAt ? Date.parse(b.enteredAt) : 0;
    if (at !== bt) return at - bt;
    return a.ticketNumber.localeCompare(b.ticketNumber);
  });
}

/** Whole minutes between two timestamps, or null when either is missing. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 60_000));
}

/** Waiting time so far for a still-active ticket, in whole minutes. */
export function waitingMinutes(entry: QueueEntryRow, now: number = Date.now()): number | null {
  if (!entry.enteredAt) return null;
  const entered = Date.parse(entry.enteredAt);
  if (Number.isNaN(entered)) return null;
  return Math.max(0, Math.round((now - entered) / 60_000));
}

/** Shape every queue raw call rejects with, matching the query error contract. */
export interface QueueCallError {
  readonly code: string;
  readonly status: number;
}

export interface QueueQuery {
  readonly departmentId?: string;
  readonly status?: string;
}

/**
 * Raw board read against `GET /queue?departmentId=&status=`.
 *
 * The export leaves `/queue`'s query unmodelled (`query: never`) and mis-types the
 * 200 as the request DTO (GAP-017), so this uses the facilities/patient precedent:
 * same-origin fetch (cookies ride along), a drift-safe envelope check, then
 * structural row validation.
 */
export async function fetchQueue(
  query: QueueQuery = {},
  signal?: AbortSignal,
): Promise<QueuePage> {
  const params = new URLSearchParams();
  if (query.departmentId) params.set('departmentId', query.departmentId);
  if (query.status) params.set('status', query.status);
  const suffix = params.toString();
  const url = `${publicEnv.apiBasePath}/queue${suffix ? `?${suffix}` : ''}`;
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw { code: queueErrorCodeFrom(body), status: response.status } satisfies QueueCallError;
  }
  const envelope = isRecord(body) ? body : {};
  if (envelope.success !== true || !isRecord(envelope.data)) {
    throw { code: 'INTERNAL_ERROR', status: 200 } satisfies QueueCallError;
  }
  const parsed = extractQueuePage(envelope.data);
  if (!parsed.ok) {
    throw { code: 'INTERNAL_ERROR', status: 200 } satisfies QueueCallError;
  }
  return parsed.page;
}

function queueErrorCodeFrom(body: unknown): string {
  if (!isRecord(body)) return 'INTERNAL_ERROR';
  const envelope = isRecord(body.error) ? body.error : body;
  return typeof envelope.code === 'string' ? envelope.code : 'INTERNAL_ERROR';
}
