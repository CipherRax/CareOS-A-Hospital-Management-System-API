import type { QueueEntry } from '@prisma/client';
import { ACTIVE_QUEUE_STATUSES } from './queue-flow';

/**
 * Pure queue-metrics helpers (brief §6.5). Everything derives from timestamps
 * already stored on QueueEntry rows; nothing here writes.
 */

export const PRIORITY_RANK: Record<QueueEntry['operationalPriority'], number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export interface QueueStats {
  /** Average minutes from enteredAt → serviceStartedAt (those that started). */
  avgCallWaitMinutes: number | null;
  /** Average minutes from serviceStartedAt → completedAt. */
  avgServiceMinutes: number | null;
  /** Fraction (0..1) of same-window entries that no-showed / abandoned. */
  abandonmentRate: number | null;
  /** Active (WAITING/CALLED/IN_SERVICE) entries in the window. */
  currentlyWaiting: number;
}

function minutes(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / 60_000;
}

function rate(durations: Array<number | null>): number | null {
  const clean = durations.filter((d): d is number => d !== null && Number.isFinite(d));
  if (clean.length === 0) return null;
  return clean.reduce((sum, d) => sum + d, 0) / clean.length;
}

/** Compact stats over a window of queue entries (typically a department+day). */
export function computeQueueStats(
  entries: Pick<
    QueueEntry,
    'status' | 'enteredAt' | 'calledAt' | 'serviceStartedAt' | 'completedAt' | 'noShowAt'
  >[],
): QueueStats {
  const resolved = entries.filter((e) => e.status !== 'WAITING' && e.status !== 'CALLED');

  const callWait = resolved.map((e) => minutes(e.enteredAt, e.serviceStartedAt));
  const service = resolved.map((e) => minutes(e.serviceStartedAt, e.completedAt));
  const finished = resolved.filter(
    (e) => e.status === 'COMPLETED' || e.status === 'NO_SHOW' || e.status === 'ABANDONED',
  );
  const leftEarly = finished.filter(
    (e) => e.status === 'NO_SHOW' || e.status === 'ABANDONED',
  ).length;

  return {
    avgCallWaitMinutes: rate(callWait),
    avgServiceMinutes: rate(service),
    abandonmentRate: finished.length > 0 ? leftEarly / finished.length : null,
    currentlyWaiting: entries.filter((e) => ACTIVE_QUEUE_STATUSES.has(e.status)).length,
  };
}

/**
 * Sorts two queued entries by (priority desc, then enteredAt asc, then ticket).
 * The key ascends, so higher-priority rows must map to a *smaller* rank:
 * URGENT=1 … LOW=4 (inverse of PRIORITY_RANK). Mirrors the SQL ordering used by
 * the waiting-room board so the "ahead of" count matches what the display shows.
 */
export function queueSortKey(entry: {
  enteredAt: Date;
  ticketNumber: string;
  operationalPriority: QueueEntry['operationalPriority'];
}): string {
  const rank = String(5 - PRIORITY_RANK[entry.operationalPriority]).padStart(2, '0');
  const entered = entry.enteredAt.getTime().toString().padStart(16, '0');
  return `${rank}-${entered}-${entry.ticketNumber}`;
}

/** Count of active entries that sort ahead of `targetId` (self excluded). */
export function peopleAhead(
  entries: Array<{
    id: string;
    ticketNumber: string;
    enteredAt: Date;
    operationalPriority: QueueEntry['operationalPriority'];
    status: QueueEntry['status'];
  }>,
  targetId: string,
): number {
  const ordered = entries
    .filter((e) => e.status !== 'COMPLETED' && e.status !== 'NO_SHOW')
    .sort((a, b) => queueSortKey(a).localeCompare(queueSortKey(b)));
  const index = ordered.findIndex((e) => e.id === targetId);
  return index === -1 ? 0 : index;
}

/**
 * Estimated remaining wait (minutes) = people ahead × avg service time, plus
 * a low-high band so the number is presented as labelled *estimate*.
 */
export function estimateWaitMinutes(
  stats: Pick<QueueStats, 'avgServiceMinutes'>,
  ahead: number,
  avgCall: number | null = null,
): { minMinutes: number; maxMinutes: number } | null {
  const per = stats.avgServiceMinutes ?? avgCall;
  if (per === null) return null;
  const base = Math.max(0, ahead * per);
  return { minMinutes: Math.round(base * 0.7), maxMinutes: Math.round(base * 1.3) };
}