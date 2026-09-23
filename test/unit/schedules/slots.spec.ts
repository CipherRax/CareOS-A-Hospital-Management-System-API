import type { ProviderSchedule, ScheduleOverride } from '@prisma/client';
import { generateSlots, windowsForDay } from '../../../src/modules/schedules/domain/slots';

const day = new Date('2026-09-23T00:00:00Z'); // a Wednesday

function template(partial: Partial<ProviderSchedule>): ProviderSchedule {
  return {
    id: 'tpl-1',
    organizationId: 'org-1',
    providerId: 'prov-1',
    departmentId: 'dept-1',
    dayOfWeek: 2,
    startMinutes: 480,
    endMinutes: 720,
    slotDurationMinutes: 30,
    capacity: 1,
    isAvailable: true,
    ...partial,
  } as ProviderSchedule;
}

function override(partial: Partial<ScheduleOverride>): ScheduleOverride {
  return {
    id: 'ov-1',
    organizationId: 'org-1',
    providerId: 'prov-1',
    departmentId: 'dept-1',
    date: day,
    type: 'WORKING',
    startMinutes: 600,
    endMinutes: 660,
    slotDurationMinutes: 15,
    capacity: null,
    ...partial,
  } as ScheduleOverride;
}

describe('windowsForDay', () => {
  it('uses weekly templates when no override applies', () => {
    const windows = windowsForDay(day, [template({})], []);
    expect(windows).toEqual([
      { startMinutes: 480, endMinutes: 720, slotDurationMinutes: 30, capacity: 1 },
    ]);
  });

  it('ignores templates of other weekdays', () => {
    const windows = windowsForDay(day, [template({ dayOfWeek: 4, capacity: 2 })], []);
    expect(windows).toHaveLength(0);
  });

  it('BLOCKED/HOLIDAY/LEAVE override empties the day', () => {
    for (const type of ['BLOCKED', 'HOLIDAY', 'LEAVE'] as const) {
      expect(windowsForDay(day, [template({})], [override({ type })])).toEqual([]);
    }
  });

  it('WORKING override replaces the weekly template', () => {
    const windows = windowsForDay(day, [template({})], [override({})]);
    expect(windows).toEqual([
      { startMinutes: 600, endMinutes: 660, slotDurationMinutes: 15, capacity: 1 },
    ]);
  });
});

describe('generateSlots', () => {
  it('emits slots per window and orders by start', () => {
    const slots = generateSlots({
      date: day,
      templates: [template({ startMinutes: 480, endMinutes: 540, slotDurationMinutes: 30 })],
      overrides: [],
      bookings: [],
      now: new Date('2026-09-22T00:00:00Z'),
    });
    expect(slots).toHaveLength(2);
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-09-23T08:00:00.000Z');
    expect(slots[1]!.startsAt.toISOString()).toBe('2026-09-23T08:30:00.000Z');
  });

  it('marks PAST slots unless includePast is set', () => {
    const slots = generateSlots({
      date: day,
      templates: [template({})],
      overrides: [],
      bookings: [],
      now: new Date('2026-09-23T09:00:00Z'),
    });
    expect(slots[0]!.status).toBe('PAST');
    expect(slots.some((s) => s.status === 'AVAILABLE')).toBe(true);
  });

  it('treats occupying bookings as consumed capacity', () => {
    const slots = generateSlots({
      date: day,
      templates: [template({ capacity: 2 })],
      overrides: [],
      bookings: [
        { startsAt: new Date('2026-09-23T08:00:00Z'), endsAt: new Date('2026-09-23T08:30:00Z'), status: 'CONFIRMED' },
        { startsAt: new Date('2026-09-23T08:00:00Z'), endsAt: new Date('2026-09-23T08:30:00Z'), status: 'BOOKED' },
      ],
      now: new Date('2026-09-22T00:00:00Z'),
      includePast: true,
    });
    const slot = slots.find((s) => s.startsAt.toISOString() === '2026-09-23T08:00:00.000Z')!;
    expect(slot.booked).toBe(2);
    expect(slot.remaining).toBe(0);
    expect(slot.status).toBe('FULL');
  });

  it('ignores non-occupying bookings (cancelled/no-show)', () => {
    const slots = generateSlots({
      date: day,
      templates: [template({ capacity: 1 })],
      overrides: [],
      bookings: [
        { startsAt: new Date('2026-09-23T08:00:00Z'), endsAt: new Date('2026-09-23T08:30:00Z'), status: 'CANCELLED' },
      ],
      now: new Date('2026-09-22T00:00:00Z'),
      includePast: true,
    });
    expect(slots.find((s) => s.startsAt.toISOString() === '2026-09-23T08:00:00.000Z')!.status).toBe('AVAILABLE');
  });

  it('skips degenerate windows', () => {
    const slots = generateSlots({
      date: day,
      templates: [template({ startMinutes: 480, endMinutes: 480, slotDurationMinutes: 0 })],
      overrides: [],
      bookings: [],
      now: new Date('2026-09-22T00:00:00Z'),
    });
    expect(slots).toHaveLength(0);
  });
});