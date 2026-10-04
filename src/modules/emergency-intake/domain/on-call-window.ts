/**
 * On-call windows (brief §6.15: "ordered EmergencyContacts (user or phone +
 * role, on-call windows)").
 *
 * `onCall` on its own is a boolean a human flips, which goes stale the moment a
 * shift ends. A window lets the system decide who is reachable, so an escalation
 * does not depend on someone remembering to clear a flag — the failure mode that
 * leaves a caller believing a facility was alerted when nobody was paged.
 *
 * Windows are stored per contact as a JSON array of daily ranges in the
 * facility's local time. A contact with no windows configured is treated as
 * always reachable, which keeps existing single-site deployments working without
 * a migration.
 */

export interface OnCallWindow {
  /** 0 = Sunday .. 6 = Saturday, matching JavaScript's Date#getDay. */
  day: number;
  /** Inclusive start, 24-hour "HH:MM". */
  start: string;
  /** Exclusive end, 24-hour "HH:MM". "24:00" is accepted for end-of-day. */
  end: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Structural check so a malformed row cannot silently disable every window. */
export function isValidOnCallWindow(window: OnCallWindow): boolean {
  // The JSON column is untrusted: it can hold null, a string, or a number if a
  // row was written outside the API, so the shape is checked before any field is
  // read rather than assumed.
  if (typeof window !== 'object' || window === null) return false;
  const { day, start, end } = window;
  if (typeof day !== 'number' || typeof start !== 'string' || typeof end !== 'string') return false;
  return (
    Number.isInteger(day) &&
    day >= 0 &&
    day <= 6 &&
    HHMM.test(start) &&
    (HHMM.test(end) || end === '24:00')
  );
}

function minutesOf(hhmm: string): number {
  if (hhmm === '24:00') return 24 * 60;
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * Whether a contact is within one of their on-call windows at `at`.
 *
 * An empty/absent window list means "always on call". A window list that is
 * present but entirely invalid also resolves to always-on-call: an operator
 * typing `25:00` must not silently take a whole shift off the escalation chain.
 * That is the safer failure because the notification still goes to a human, who
 * can notice it is the wrong hour.
 */
export function isOnCallAt(windows: unknown, at: Date): boolean {
  if (!Array.isArray(windows) || windows.length === 0) return true;
  const usable = windows.filter(isValidOnCallWindow);
  if (usable.length === 0) return true;

  const day = at.getDay();
  const now = at.getHours() * 60 + at.getMinutes();
  return usable.some((w) => {
    if (w.day !== day) return false;
    const start = minutesOf(w.start);
    const end = minutesOf(w.end);
    // A window whose end is not after its start wraps past midnight, which is
    // how a night shift ("20:00" -> "06:00") is expressed on its start day.
    return end > start ? now >= start && now < end : now >= start || now < end;
  });
}

/** Parses an untrusted JSON column into usable windows, dropping bad entries. */
export function parseOnCallWindows(raw: unknown): OnCallWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidOnCallWindow);
}