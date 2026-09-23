import type { Appointment, ProviderSchedule, ScheduleOverride } from '@prisma/client';
import { dayOfWeekForDate } from './workweek';

/**
 * Pure slot generation. Availability for a day is decided as:
 *
 *  1. Per-date overrides for the provider/day win if present:
 *     - LEAVE / HOLIDAY / BLOCKED ⇒ the whole day is unavailable.
 *     - WORKING ⇒ its explicit windows replace the weekly template entirely.
 *  2. Otherwise the weekly templates for that dayOfWeek are used; rows with
 *     isAvailable=false are standing blocked windows (breaks, meetings).
 *
 * Bookings are subtracted per slot to expose the remaining capacity. Past slots
 * are filtered out for booking/list purposes unless `includePast` is set.
 */

export type AvailabilityStatus = 'AVAILABLE' | 'FULL' | 'PAST' | 'UNAVAILABLE';

export interface SlotWindow {
  startMinutes: number;
  endMinutes: number;
  slotDurationMinutes: number;
  capacity: number;
}

export interface AvailableSlot {
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
  remaining: number;
  status: AvailabilityStatus;
}

/** The set of appointment statuses that still occupy a slot (consume capacity). */
export const BOOKING_OCCUPYING_STATUSES = new Set([
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
]);

/** Extracts usable booking windows for a single day, honoring overrides first. */
export function windowsForDay(
  date: Date,
  templates: ProviderSchedule[],
  overrides: ScheduleOverride[],
): SlotWindow[] {
  const day = dayOfWeekForDate(date);

  const applicable = overrides.filter(
    (o) => o.date.getTime() === date.getTime() && o.type !== undefined,
  );
  if (applicable.some((o) => o.type === 'LEAVE' || o.type === 'HOLIDAY' || o.type === 'BLOCKED')) {
    return [];
  }

  const working = applicable.filter((o) => o.type === 'WORKING');
  if (working.length > 0) {
    return working
      .filter(
        (o) =>
          o.startMinutes !== null &&
          o.endMinutes !== null &&
          o.slotDurationMinutes !== null,
      )
      .map((o) => ({
        startMinutes: o.startMinutes as number,
        endMinutes: o.endMinutes as number,
        slotDurationMinutes: o.slotDurationMinutes as number,
        capacity: o.capacity ?? 1,
      }));
  }

  return templates
    .filter((t) => t.dayOfWeek === day)
    .map((t) => ({
      startMinutes: t.startMinutes,
      endMinutes: t.endMinutes,
      slotDurationMinutes: t.slotDurationMinutes,
      capacity: t.capacity,
    }));
}

/**
 * Generates concrete slots for `date` (UTC-midnight). Pass the day's booked
 * appointments for that provider so remaining capacity and occupancy can be
 * computed. `now` is the clock used to decide PAST.
 */
export function generateSlots(options: {
  date: Date;
  templates: ProviderSchedule[];
  overrides: ScheduleOverride[];
  bookings: Pick<
    Appointment,
    'startsAt' | 'endsAt' | 'status'
  >[];
  now?: Date;
  includePast?: boolean;
}): AvailableSlot[] {
  const { date, templates, overrides, bookings, includePast = false } = options;
  const now = options.now ?? new Date();

  const windows = windowsForDay(date, templates, overrides);

  // Lead the slots on each window; a window without a positive duration yields nothing.
  const slots: AvailableSlot[] = [];

  for (const window of windows) {
    if (
      window.slotDurationMinutes <= 0 ||
      window.endMinutes <= window.startMinutes ||
      window.capacity <= 0
    ) {
      continue;
    }
    for (
      let start = window.startMinutes;
      start + window.slotDurationMinutes <= window.endMinutes;
      start += window.slotDurationMinutes
    ) {
      const startsAt = new Date(date.getTime() + start * 60_000);
      const endsAt = new Date(startsAt.getTime() + window.slotDurationMinutes * 60_000);
      const booked = bookings.filter(
        (b) =>
          b.startsAt.getTime() === startsAt.getTime() &&
          BOOKING_OCCUPYING_STATUSES.has(b.status),
      ).length;
      const remaining = Math.max(0, window.capacity - booked);
      const available = remaining > 0;

      let status: AvailabilityStatus;
      if (!available) status = 'FULL';
      else if (!includePast && startsAt.getTime() <= now.getTime()) status = 'PAST';
      else status = 'AVAILABLE';

      slots.push({
        startsAt,
        endsAt,
        capacity: window.capacity,
        booked,
        remaining,
        status,
      });
    }
  }

  // Order by start time (stable for two windows that share a start minute).
  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return slots;
}