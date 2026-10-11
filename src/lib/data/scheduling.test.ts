import { describe, expect, it } from 'vitest';

import {
  ACTIONABLE_WAITLIST_STATUSES,
  APPOINTMENT_TRANSITIONS,
  TERMINAL_APPOINTMENT_STATUSES,
  byStartTime,
  dayKey,
  dayRange,
  extractAppointmentPage,
  extractAppointmentRecord,
  extractProviderPage,
  extractSlotDay,
  extractWaitlistPage,
  extractWaitlistRecord,
  readAppointment,
  readSlot,
  readWaitlistEntry,
  todayISO,
  type AppointmentRow,
} from '@/lib/data/scheduling';

/**
 * F3 scheduling data layer.
 *
 * The export mis-types every appointment/schedule 200 as its request DTO and
 * leaves the queries unmodelled (GAP-017/018), so these readers — the ones the
 * desk trusts — are pinned directly. A reader that accepts a drifted body is an
 * appointment that silently disappears from the day book, or a booking confirmed
 * against a body that never named a slot.
 */

const row = {
  id: 'apt_example_4001',
  organizationId: 'org_example_0001',
  branchId: 'br_example_0001',
  departmentId: 'dep_example_outpatient',
  patientId: 'pat_example_1001',
  providerId: 'usr_example_9001',
  startsAt: '2026-10-11T09:00:00.000Z',
  endsAt: '2026-10-11T09:30:00.000Z',
  mode: 'IN_PERSON',
  appointmentType: 'Follow-up',
  reason: 'Blood pressure review.',
  status: 'BOOKED',
  version: 1,
};

describe('readAppointment', () => {
  it('reads a serialized appointment', () => {
    expect(readAppointment(row)).toMatchObject({
      id: 'apt_example_4001',
      patientId: 'pat_example_1001',
      status: 'BOOKED',
      mode: 'IN_PERSON',
    });
  });

  it('rejects a row that cannot be an appointment', () => {
    expect(readAppointment({})).toBeNull();
    expect(readAppointment({ id: 1, startsAt: row.startsAt, status: 'BOOKED' })).toBeNull();
    expect(readAppointment(null)).toBeNull();
  });

  it('defaults a missing mode and end time instead of failing the row', () => {
    const minimal = { id: row.id, startsAt: row.startsAt, status: row.status };
    expect(readAppointment(minimal)?.mode).toBe('IN_PERSON');
    expect(readAppointment(minimal)?.endsAt).toBe(row.startsAt);
  });
});

describe('extractAppointmentPage', () => {
  it('reads the { items, meta } body', () => {
    const parsed = extractAppointmentPage({ items: [row], meta: { total: 1 } });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty items array as an empty day', () => {
    const parsed = extractAppointmentPage({ items: [], meta: { total: 0 } });
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
  });

  it('fails closed when items is missing or malformed', () => {
    expect(extractAppointmentPage({ meta: {} })).toEqual({ ok: false });
    expect(extractAppointmentPage({ items: [{}] })).toEqual({ ok: false });
    expect(extractAppointmentPage(null)).toEqual({ ok: false });
  });

  it('falls back to the item count when meta.total is absent', () => {
    const parsed = extractAppointmentPage({ items: [row] });
    expect(parsed.ok && parsed.page.total).toBe(1);
  });
});

describe('readWaitlistEntry', () => {
  const entry = {
    id: 'wl_example_5001',
    branchId: 'br_example_0001',
    departmentId: 'dep_example_outpatient',
    patientId: 'pat_example_1001',
    providerId: null,
    status: 'WAITING',
    preferredDate: '2026-10-20T00:00:00.000Z',
    notes: 'Prefers mornings.',
  };

  it('reads a serialized entry', () => {
    expect(readWaitlistEntry(entry)).toMatchObject({
      id: 'wl_example_5001',
      status: 'WAITING',
      providerId: null,
    });
  });

  it('rejects a row without an id or status', () => {
    expect(readWaitlistEntry({ status: 'WAITING' })).toBeNull();
    expect(readWaitlistEntry({ id: 'x' })).toBeNull();
  });

  it('reads an { items, meta } waitlist page', () => {
    const parsed = extractWaitlistPage({ items: [entry] });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(extractWaitlistPage({ items: [{}] })).toEqual({ ok: false });
  });

  it('reads the { entry } body a join answers with', () => {
    const parsed = extractWaitlistRecord({ entry });
    expect(parsed.ok && parsed.entry.id).toBe('wl_example_5001');
    expect(extractWaitlistRecord({})).toEqual({ ok: false });
  });
});

describe('extractProviderPage', () => {
  it('reads the provider directory', () => {
    const parsed = extractProviderPage({
      items: [
        { id: 'usr_example_9001', name: 'EXAMPLE Dr Mwangi', bookable: true, departmentIds: ['dep_1'] },
      ],
    });
    expect(parsed.ok && parsed.providers).toHaveLength(1);
    expect(parsed.ok && parsed.providers[0]?.name).toBe('EXAMPLE Dr Mwangi');
  });

  it('drops entries that are not named providers instead of inventing a blank option', () => {
    const parsed = extractProviderPage({
      items: [{ id: 'usr_1', name: 'EXAMPLE Dr A' }, { id: 'usr_2' }, { name: 'No id' }, 42],
    });
    expect(parsed.ok && parsed.providers).toHaveLength(1);
  });

  it('fails closed without an items array', () => {
    expect(extractProviderPage({ providers: [] })).toEqual({ ok: false });
    expect(extractProviderPage(null)).toEqual({ ok: false });
  });
});

describe('readSlot and extractSlotDay', () => {
  const slot = {
    startsAt: '2026-10-11T09:00:00.000Z',
    endsAt: '2026-10-11T09:30:00.000Z',
    capacity: 2,
    booked: 1,
    remaining: 1,
    status: 'AVAILABLE',
  };

  it('reads a slot and derives remaining when it is absent', () => {
    expect(readSlot(slot)).toMatchObject({ status: 'AVAILABLE', remaining: 1 });
    expect(readSlot({ ...slot, remaining: undefined })?.remaining).toBe(1);
  });

  it('rejects a slot without both timestamps', () => {
    expect(readSlot({ startsAt: slot.startsAt })).toBeNull();
    expect(readSlot(null)).toBeNull();
  });

  it('reads the { date, slots } day body', () => {
    const parsed = extractSlotDay({ date: '2026-10-11T00:00:00.000Z', slots: [slot] });
    expect(parsed.ok && parsed.day.slots).toHaveLength(1);
    expect(parsed.ok && parsed.day.date).toBe('2026-10-11T00:00:00.000Z');
  });

  it('fails closed without a slots array', () => {
    expect(extractSlotDay({ date: 'x' })).toEqual({ ok: false });
    expect(extractSlotDay({ slots: [{}] })).toEqual({ ok: false });
  });
});

describe('extractAppointmentRecord', () => {
  it('reads the { appointment } mutation body', () => {
    const parsed = extractAppointmentRecord({ appointment: row });
    expect(parsed.ok && parsed.appointment.id).toBe('apt_example_4001');
    expect(extractAppointmentRecord({})).toEqual({ ok: false });
  });
});

describe('ordering and day helpers', () => {
  it('orders appointments earliest first', () => {
    const later = { ...row, id: 'later', startsAt: '2026-10-11T10:00:00.000Z' } as AppointmentRow;
    const earlier = { ...row, id: 'earlier', startsAt: '2026-10-11T08:00:00.000Z' } as AppointmentRow;
    expect(byStartTime([later, earlier]).map((a) => a.id)).toEqual(['earlier', 'later']);
  });

  it('keys a timestamp to its UTC business day', () => {
    expect(dayKey('2026-10-11T12:00:00.000Z')).toBe('2026-10-11');
    expect(dayKey('2026-10-11T23:30:00.000Z')).toBe('2026-10-11');
    expect(dayKey('nonsense')).toBe('');
  });

  it('widens a day to an inclusive UTC range', () => {
    const range = dayRange('2026-10-11');
    const from = new Date(range.dateFrom);
    const to = new Date(range.dateTo);
    expect(from.getUTCFullYear()).toBe(2026);
    expect(from.getUTCMonth()).toBe(9);
    expect(from.getUTCDate()).toBe(11);
    expect(from.getUTCHours()).toBe(0);
    expect(to.getUTCDate()).toBe(11);
    expect(to.getTime()).toBeGreaterThan(from.getTime());
  });

  it('defaults the desk to today on the UTC clock', () => {
    expect(todayISO(new Date('2026-01-05T09:00:00.000Z'))).toBe('2026-01-05');
  });
});

describe('the appointment flow', () => {
  it('offers the API transition graph', () => {
    expect(APPOINTMENT_TRANSITIONS.BOOKED).toContain('CONFIRMED');
    expect(APPOINTMENT_TRANSITIONS.CONFIRMED).toContain('CHECKED_IN');
    expect(APPOINTMENT_TRANSITIONS.CHECKED_IN).toContain('IN_PROGRESS');
    expect(APPOINTMENT_TRANSITIONS.IN_PROGRESS).toContain('COMPLETED');
  });

  it('never offers BOOKED or RESCHEDULED as a transition target', () => {
    for (const nexts of Object.values(APPOINTMENT_TRANSITIONS)) {
      expect(nexts).not.toContain('BOOKED');
      expect(nexts).not.toContain('RESCHEDULED');
    }
  });

  it('treats finished appointments as terminal', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']) {
      expect(APPOINTMENT_TRANSITIONS[status]).toEqual([]);
      expect(TERMINAL_APPOINTMENT_STATUSES.has(status)).toBe(true);
    }
  });

  it('counts only waiting and offered waitlist entries as actionable', () => {
    expect([...ACTIONABLE_WAITLIST_STATUSES]).toEqual(['WAITING', 'OFFERED']);
  });
});
