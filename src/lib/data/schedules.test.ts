import { describe, expect, it } from 'vitest';

import {
  OVERRIDE_TYPES,
  SCHEDULE_DAYS,
  byDayAndTime,
  extractOverrideRecord,
  extractTemplatePage,
  extractTemplateRecord,
  minutesToTime,
  overrideDateKey,
  readOverride,
  readTemplate,
  timeToMinutes,
  type ScheduleTemplateRow,
} from '@/lib/data/schedules';

/**
 * F3 schedule-admin data layer.
 *
 * The export mis-types the template list 200 as its request DTO and leaves the
 * query unmodelled (GAP-017), so the readers below are what the admin screen
 * trusts. A reader that accepts a drifted row is a clinic hour that silently
 * disappears from the week.
 */

const template = {
  id: 'sch_example_8001',
  organizationId: 'org_example_0001',
  providerId: 'usr_example_9101',
  branchId: 'br_example_0001',
  departmentId: 'dep_example_outpatient',
  dayOfWeek: 0,
  startMinutes: 480,
  endMinutes: 780,
  slotDurationMinutes: 30,
  capacity: 1,
  isAvailable: true,
  note: null,
  createdAt: '2026-01-04T06:00:00.000Z',
  updatedAt: '2026-01-04T06:00:00.000Z',
};

describe('readTemplate', () => {
  it('reads a serialized template', () => {
    expect(readTemplate(template)).toMatchObject({
      id: 'sch_example_8001',
      dayOfWeek: 0,
      startMinutes: 480,
      endMinutes: 780,
    });
  });

  it('rejects a row that cannot describe a window', () => {
    expect(readTemplate({})).toBeNull();
    expect(readTemplate({ id: 'sch_1', providerId: 'usr_1', dayOfWeek: 0 })).toBeNull();
    expect(readTemplate(null)).toBeNull();
  });

  it('defaults slot duration and capacity rather than dropping the window', () => {
    const minimal = { id: 's', providerId: 'p', dayOfWeek: 2, startMinutes: 0, endMinutes: 60 };
    expect(readTemplate(minimal)?.slotDurationMinutes).toBe(30);
    expect(readTemplate(minimal)?.capacity).toBe(1);
    expect(readTemplate(minimal)?.isAvailable).toBe(true);
  });
});

describe('extractTemplatePage', () => {
  it('reads the { items, meta } body', () => {
    const parsed = extractTemplatePage({ items: [template], meta: { total: 1 } });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty list as a provider with no hours', () => {
    const parsed = extractTemplatePage({ items: [] });
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
  });

  it('fails closed on a malformed body', () => {
    expect(extractTemplatePage({ items: [{}] })).toEqual({ ok: false });
    expect(extractTemplatePage(null)).toEqual({ ok: false });
  });

  it('reads the { schedule } mutation body', () => {
    const parsed = extractTemplateRecord({ schedule: template });
    expect(parsed.ok && parsed.template.id).toBe('sch_example_8001');
    expect(extractTemplateRecord({})).toEqual({ ok: false });
  });
});

describe('readOverride', () => {
  const override = {
    id: 'ovr_example_8101',
    providerId: 'usr_example_9101',
    branchId: 'br_example_0001',
    departmentId: 'dep_example_outpatient',
    date: '2026-10-20T00:00:00.000Z',
    type: 'LEAVE',
    startMinutes: null,
    endMinutes: null,
    slotDurationMinutes: null,
    capacity: null,
    note: 'Annual leave.',
  };

  it('reads a serialized override', () => {
    expect(readOverride(override)).toMatchObject({ id: 'ovr_example_8101', type: 'LEAVE' });
  });

  it('rejects a row without an id, provider, date or type', () => {
    expect(readOverride({ id: 'o', providerId: 'p', date: 'x' })).toBeNull();
    expect(readOverride({ id: 'o' })).toBeNull();
  });

  it('reads nullable windows as null', () => {
    const read = readOverride(override);
    expect(read?.startMinutes).toBeNull();
    expect(read?.capacity).toBeNull();
  });

  it('reads the { override } mutation body', () => {
    const parsed = extractOverrideRecord({ override });
    expect(parsed.ok && parsed.override.type).toBe('LEAVE');
    expect(extractOverrideRecord({})).toEqual({ ok: false });
  });
});

describe('time helpers', () => {
  it('formats a minute offset as HH:MM', () => {
    expect(minutesToTime(480)).toBe('08:00');
    expect(minutesToTime(780)).toBe('13:00');
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(1440)).toBe('24:00');
  });

  it('parses HH:MM back to a minute offset, and rejects nonsense', () => {
    expect(timeToMinutes('08:00')).toBe(480);
    expect(timeToMinutes('13:30')).toBe(810);
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('noon')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
  });

  it('round-trips the window boundaries the API uses', () => {
    expect(timeToMinutes(minutesToTime(780))).toBe(780);
  });

  it('keys an override timestamp to its date', () => {
    expect(overrideDateKey('2026-10-20T00:00:00.000Z')).toBe('2026-10-20');
  });
});

describe('ordering and vocabulary', () => {
  it('orders templates by day then start time', () => {
    const mon = { ...template, id: 'a', dayOfWeek: 0, startMinutes: 600 } as ScheduleTemplateRow;
    const monEarly = { ...template, id: 'b', dayOfWeek: 0, startMinutes: 480 } as ScheduleTemplateRow;
    const tue = { ...template, id: 'c', dayOfWeek: 1, startMinutes: 480 } as ScheduleTemplateRow;
    expect(byDayAndTime([mon, tue, monEarly]).map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('mirrors the API day and override vocabularies', () => {
    expect([...SCHEDULE_DAYS]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...OVERRIDE_TYPES]).toEqual(['WORKING', 'LEAVE', 'HOLIDAY', 'BLOCKED']);
  });
});

describe('readTemplate bounds', () => {
  it('keeps a non-available row as a standing blocked window', () => {
    const read = readTemplate({ ...template, isAvailable: false });
    expect(read?.isAvailable).toBe(false);
  });
});
