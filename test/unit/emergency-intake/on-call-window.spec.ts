import {
  isOnCallAt,
  isValidOnCallWindow,
  parseOnCallWindows,
} from '../../../src/modules/emergency-intake/domain/on-call-window';
import { evaluateIntakeReadiness } from '../../../src/modules/emergency-intake/domain/intake-readiness';

/** Wednesday, 10:00 local. */
const WEDNESDAY_10AM = new Date(2026, 0, 7, 10, 0, 0);
/** Wednesday, 03:00 local. */
const WEDNESDAY_3AM = new Date(2026, 0, 7, 3, 0, 0);
// 2026-01-07 is a Wednesday, so day 3.

describe('on-call windows', () => {
  describe('isValidOnCallWindow', () => {
    it('accepts a well-formed window', () => {
      expect(isValidOnCallWindow({ day: 3, start: '08:00', end: '17:00' })).toBe(true);
    });

    it('accepts 24:00 only as an end', () => {
      expect(isValidOnCallWindow({ day: 3, start: '20:00', end: '24:00' })).toBe(true);
      expect(isValidOnCallWindow({ day: 3, start: '24:00', end: '23:00' })).toBe(false);
    });

    it('rejects an out-of-range day or time', () => {
      expect(isValidOnCallWindow({ day: 7, start: '08:00', end: '17:00' })).toBe(false);
      expect(isValidOnCallWindow({ day: -1, start: '08:00', end: '17:00' })).toBe(false);
      expect(isValidOnCallWindow({ day: 3, start: '8:00', end: '17:00' })).toBe(false);
      expect(isValidOnCallWindow({ day: 3, start: '08:70', end: '17:00' })).toBe(false);
    });
  });

  describe('isOnCallAt', () => {
    it('treats a contact with no windows as always on call', () => {
      // Backwards compatibility: existing single-site deployments set no windows.
      expect(isOnCallAt([], WEDNESDAY_3AM)).toBe(true);
      expect(isOnCallAt(null, WEDNESDAY_3AM)).toBe(true);
      expect(isOnCallAt(undefined, WEDNESDAY_3AM)).toBe(true);
    });

    it('is on call inside a window on the matching day', () => {
      expect(isOnCallAt([{ day: 3, start: '08:00', end: '17:00' }], WEDNESDAY_10AM)).toBe(true);
    });

    it('is off call outside the window', () => {
      expect(isOnCallAt([{ day: 3, start: '08:00', end: '17:00' }], WEDNESDAY_3AM)).toBe(false);
    });

    it('is off call on a day the contact does not work', () => {
      // A Monday-only roster must not page someone on a Wednesday.
      expect(isOnCallAt([{ day: 1, start: '08:00', end: '17:00' }], WEDNESDAY_10AM)).toBe(false);
    });

    it('is on call if any of several windows matches', () => {
      const windows = [
        { day: 1, start: '08:00', end: '12:00' },
        { day: 3, start: '09:00', end: '11:00' },
      ];
      expect(isOnCallAt(windows, WEDNESDAY_10AM)).toBe(true);
    });

    it('handles a night shift that wraps past midnight', () => {
      // "20:00 -> 06:00" covers the small hours of the following day, which is how
      // an overnight duty roster is actually written.
      const night = [{ day: 3, start: '20:00', end: '06:00' }];
      expect(isOnCallAt(night, WEDNESDAY_3AM)).toBe(true);
      expect(isOnCallAt(night, WEDNESDAY_10AM)).toBe(false);
    });

    it('treats the end boundary as exclusive and the start as inclusive', () => {
      const windows = [{ day: 3, start: '10:00', end: '11:00' }];
      expect(isOnCallAt(windows, new Date(2026, 0, 7, 10, 0))).toBe(true);
      expect(isOnCallAt(windows, new Date(2026, 0, 7, 10, 59))).toBe(true);
      expect(isOnCallAt(windows, new Date(2026, 0, 7, 11, 0))).toBe(false);
    });

    it('supports a full-day window ending at 24:00', () => {
      const allDay = [{ day: 3, start: '00:00', end: '24:00' }];
      expect(isOnCallAt(allDay, WEDNESDAY_3AM)).toBe(true);
      expect(isOnCallAt(allDay, WEDNESDAY_10AM)).toBe(true);
    });

    it('falls back to always-on-call when every window is malformed', () => {
      // A typo must not silently take a whole shift off the escalation chain. The
      // safer failure is paging a human who can notice it is the wrong hour.
      expect(isOnCallAt([{ day: 9, start: '88:00', end: '99:00' }], WEDNESDAY_3AM)).toBe(true);
    });

    it('ignores malformed entries but honours valid ones', () => {
      const windows = [{ day: 9, start: '88:00', end: '99:00' }, { day: 3, start: '08:00', end: '17:00' }];
      expect(isOnCallAt(windows, WEDNESDAY_10AM)).toBe(true);
      expect(isOnCallAt(windows, WEDNESDAY_3AM)).toBe(false);
    });
  });

  describe('parseOnCallWindows', () => {
    it('drops unusable entries from an untrusted column', () => {
      const parsed = parseOnCallWindows([
        { day: 3, start: '08:00', end: '17:00' },
        'not-a-window',
        { day: 42, start: '08:00', end: '09:00' },
        null,
      ]);
      expect(parsed).toEqual([{ day: 3, start: '08:00', end: '17:00' }]);
    });

    it('returns an empty list for a non-array column', () => {
      expect(parseOnCallWindows(null)).toEqual([]);
      expect(parseOnCallWindows('{}')).toEqual([]);
    });
  });
});

describe('intake readiness with on-call windows', () => {
  const base = { enabled: true, autoEscalate: true, levelSeconds: [120] };

  it('stays ready when the only contact is off shift', () => {
    // Refusing a caller because the roster shows nobody on duty would be the most
    // dangerous outcome on this surface. Windows decide who is paged, not whether
    // a person asking for help can submit.
    const readiness = evaluateIntakeReadiness({
      ...base,
      contacts: [
        {
          active: true,
          onCall: true,
          hasChannel: true,
          onShiftAt: () => false,
        },
      ],
      at: WEDNESDAY_3AM,
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.reachableContacts).toBe(1);
    expect(readiness.offShiftContacts).toBe(1);
  });

  it('counts only the off-shift contacts', () => {
    const readiness = evaluateIntakeReadiness({
      ...base,
      contacts: [
        { active: true, onCall: true, hasChannel: true, onShiftAt: () => true },
        { active: true, onCall: true, hasChannel: true, onShiftAt: () => false },
        // Disabled contacts are off nobody's rota; they are not "off shift".
        { active: false, onCall: true, hasChannel: true, onShiftAt: () => false },
        // Contacts without a channel cannot be paged at all.
        { active: true, onCall: true, hasChannel: false, onShiftAt: () => false },
      ],
      at: WEDNESDAY_3AM,
    });
    expect(readiness.offShiftContacts).toBe(1);
  });

  it('reports no off-shift contacts when no instant is supplied', () => {
    const readiness = evaluateIntakeReadiness({
      ...base,
      contacts: [{ active: true, onCall: true, hasChannel: true, onShiftAt: () => false }],
    });
    expect(readiness.offShiftContacts).toBe(0);
  });

  it('still fails readiness for a contact with no way to be reached', () => {
    const readiness = evaluateIntakeReadiness({
      ...base,
      contacts: [{ active: true, onCall: false, hasChannel: true, onShiftAt: () => true }],
      at: WEDNESDAY_3AM,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain('NO_CONTACT_CHANNEL');
  });
});