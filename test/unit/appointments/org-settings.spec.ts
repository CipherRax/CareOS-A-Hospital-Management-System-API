import {
  DEFAULT_WAITLIST_SETTINGS,
  parseOrgSettings,
} from '../../../src/modules/appointments/domain/org-settings';

describe('org-settings', () => {
  it('returns defaults for no row', () => {
    expect(parseOrgSettings(undefined)).toEqual({ waitlist: DEFAULT_WAITLIST_SETTINGS });
    expect(parseOrgSettings(null)).toEqual({ waitlist: DEFAULT_WAITLIST_SETTINGS });
    expect(parseOrgSettings({})).toEqual({ waitlist: DEFAULT_WAITLIST_SETTINGS });
  });

  it('falls back per-key when partially set', () => {
    const r = parseOrgSettings({ waitlist: { offerExpiryMinutes: 5 } });
    expect(r.waitlist).toEqual({
      offerExpiryMinutes: 5,
      autoBook: false,
      maxPerDepartment: 0,
    });
  });

  it('honours explicit values', () => {
    const r = parseOrgSettings({
      waitlist: { autoBook: true, maxPerDepartment: 6, offerExpiryMinutes: 30 },
    });
    expect(r.waitlist.autoBook).toBe(true);
    expect(r.waitlist.maxPerDepartment).toBe(6);
    expect(r.waitlist.offerExpiryMinutes).toBe(30);
  });

  it('rejects an unexpected shape safely', () => {
    const r = parseOrgSettings({ waitlist: 'nope' } as unknown as Parameters<typeof parseOrgSettings>[0]);
    expect(r.waitlist).toEqual(DEFAULT_WAITLIST_SETTINGS);
  });
});