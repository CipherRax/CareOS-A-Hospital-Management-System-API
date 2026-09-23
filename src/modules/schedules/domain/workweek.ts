/**
 * Business-day helpers for schedules and the queue.
 *
 * Storage convention: dayOfWeek is 0=MONDAY .. 6=SUNDAY (a work-week index,
 * NOT JavaScript's Date.getDay()). Business dates are UTC-midnight timestamps.
 * Timezone-aware branch calendars are a later-phase concern; everything here
 * operates on the UTC clock so the API stays deterministic across the fleet.
 */

export const WORKWEEK = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export type WorkdayName = (typeof WORKWEEK)[number];
export type WorkdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 0=MONDAY .. 6=SUNDAY for a given instant (UTC-based). */
export function dayOfWeekForDate(date: Date): WorkdayIndex {
  // Date.getUTCDay(): Sun=0, Mon=1, ... Sat=6 → shift so Monday is 0.
  return ((date.getUTCDay() + 6) % 7) as WorkdayIndex;
}

/** UTC-midnight of the business day containing `date`. */
export function startOfBusinessDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Minutes since UTC midnight of the business day containing `date`. */
export function minutesOfDay(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/** Business-day key used for display tickets and queue counters (YYYY-MM-DD). */
export function businessDayKey(date: Date): string {
  const d = startOfBusinessDay(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}