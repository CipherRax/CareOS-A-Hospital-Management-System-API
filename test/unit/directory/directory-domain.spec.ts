import {
  clampLimit,
  clampRadiusKm,
  distanceKm,
  DEFAULT_NEARBY_RADIUS_KM,
  isValidCoordinate,
  MAX_NEARBY_LIMIT,
  MAX_NEARBY_RADIUS_KM,
  parseDirectorySettings,
  serializePublicListing,
  slugify,
} from '../../../src/modules/directory/domain/directory';

describe('directory geo math', () => {
  it('computes haversine distances ~ known reference points', () => {
    // Nairobi (Jomo Kenyatta airport-ish) to Mombasa (Moi airport).
    const km = distanceKm(-1.3192, 36.9278, -4.0348, 39.5942);
    expect(km).toBeGreaterThan(390);
    expect(km).toBeLessThan(510);
  });

  it('returns zero for identical points', () => {
    expect(distanceKm(-1.29, 36.82, -1.29, 36.82)).toBe(0);
  });

  it('clamps radius and limit to the public-directory bounds', () => {
    expect(clampRadiusKm(undefined)).toBe(DEFAULT_NEARBY_RADIUS_KM);
    expect(clampRadiusKm(500)).toBe(MAX_NEARBY_RADIUS_KM);
    expect(clampRadiusKm(-5)).toBe(DEFAULT_NEARBY_RADIUS_KM);
    expect(clampLimit(999)).toBe(MAX_NEARBY_LIMIT);
    expect(clampLimit(0)).toBe(20);
  });

  it('validates coordinate ranges', () => {
    expect(isValidCoordinate(-1.29, 36.82)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
  });
});

describe('directory slugs', () => {
  it('lowercases and joins word runs', () => {
    expect(slugify('St Matthews Hospital')).toBe('st-matthews-hospital');
  });

  it('strips leading/trailing separators', () => {
    expect(slugify('  --Kitui   Clinic-- ')).toBe('kitui-clinic');
  });

  it('falls back deterministically for pathological names', () => {
    const a = slugify('12');
    const b = slugify('12');
    expect(a).toBe(b);
    expect(a.startsWith('facility-')).toBe(true);
  });
});

describe('directory listing settings parsing', () => {
  it('returns safe defaults for missing/no settings', () => {
    const parsed = parseDirectorySettings(null);
    expect(parsed.listings).toEqual({});
    const branch = parseDirectorySettings({
      listings: {},
    }).listings['b1'];
    expect(branch).toBeUndefined();
  });

  it('reads per-branch settings over defaults', () => {
    const parsed = parseDirectorySettings({
      listings: {
        b1: {
          county: 'Nairobi',
          open24h: true,
          insurance: ['NHIF'],
          emergencyIntakeEnabled: true,
        },
      },
    });
    const s = parsed.listings['b1'];
    expect(s?.county).toBe('Nairobi');
    expect(s?.open24h).toBe(true);
    expect(s?.emergencyIntakeEnabled).toBe(true);
    expect(s?.ambulanceAvailable).toBe(false);
    expect(s?.insurance).toEqual(['NHIF']);
  });

  it('ignores malformed branch entries', () => {
    const parsed = parseDirectorySettings({ listings: { bad: 'nope' } });
    expect(parsed.listings['bad']).toBeUndefined();
  });
});

describe('public listing serialization', () => {
  const base = {
    id: 'l1',
    slug: 'st-matthews',
    name: 'St Matthews',
    summary: null,
    address: '1 Main St',
    county: 'Nairobi',
    town: 'Nairobi CBD',
    phone: '+254700000000',
    email: null,
    website: null,
    timezone: 'Africa/Nairobi',
    hours: { mon: ['08:00-17:00'] },
    departments: [{ name: 'OPD' }],
    insurance: ['NHIF'],
    accessibility: [],
    services: null,
    feeNote: null,
    open24h: false,
    emergency24h: true,
    ambulanceAvailable: true,
    emergencyIntakeEnabled: true,
    acceptsOnlineBooking: false,
    emergencyIntakeIndex: null,
    locationLat: -1.29,
    locationLng: 36.82,
    verificationStatus: 'DETAILS_CONFIRMED',
    partner: true,
  };

  it('serializes without a location when none recorded', () => {
    const out = serializePublicListing({ ...base, locationLat: null, locationLng: null });
    expect(out.location).toBeUndefined();
    expect(out.distanceKm).toBeUndefined();
    expect(out.name).toBe('St Matthews');
  });

  it('adds distance + location when coordinates exist', () => {
    const out = serializePublicListing(base, { distanceKm: 2.34567 });
    expect(out.distanceKm).toBe(2.35);
    expect(out.location).toEqual({ lat: -1.29, lng: 36.82 });
    expect(out.waitEstimateMinutes).toBeNull();
  });
});