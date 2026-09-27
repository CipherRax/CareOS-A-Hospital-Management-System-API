import type { Prisma } from '@prisma/client';

/**
 * Public facility directory (brief §6.14; ADR-038/039). Pure helpers: geo math,
 * slugs, per-branch listing settings and the sanitized public serializer.
 * Kept dependency-free so the geo + projection logic stays unit-testable.
 */

export const DEFAULT_TIMEZONE = 'Africa/Nairobi';
export const MAX_NEARBY_RADIUS_KM = 100;
export const DEFAULT_NEARBY_RADIUS_KM = 10;
export const DEFAULT_NEARBY_LIMIT = 20;
export const MAX_NEARBY_LIMIT = 50;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

export function clampRadiusKm(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_NEARBY_RADIUS_KM;
  return Math.min(v, MAX_NEARBY_RADIUS_KM);
}

export function clampLimit(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_NEARBY_LIMIT;
  return Math.min(Math.floor(v), MAX_NEARBY_LIMIT);
}

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Stable lowercase slug; falls back to a hash of the input when empty. */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length >= 3) return base;
  return `facility-${stableHash(name)}`;
}

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Per-branch listing settings, read through OrganizationSetting.data.listings.
// Follows the typed-reader pattern (org-settings.ts / lab-settings.ts): unknown
// or missing values fall back to safe defaults.
// ---------------------------------------------------------------------------

export interface DirectorySettings {
  listings: Record<string, BranchListingSettings>;
}

export interface BranchListingSettings {
  summary?: string | null;
  description?: string | null;
  address?: string | null;
  county?: string | null;
  town?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** Opening-week descriptor, e.g. { "mon": ["08:00-17:00"], ... }. */
  hours?: Record<string, string[]>;
  /** Departments offered at this branch, { name, services?: string[] }[]. */
  departments?: Array<{ name: string; services?: string[] }>;
  insurance?: string[];
  accessibility?: string[];
  services?: string[];
  open24h?: boolean;
  emergency24h?: boolean;
  ambulanceAvailable?: boolean;
  emergencyIntakeEnabled?: boolean;
  acceptsOnlineBooking?: boolean;
  feeNote?: string;
  locationLat?: number | null;
  locationLng?: number | null;
}

export const DEFAULT_BRANCH_LISTING_SETTINGS: BranchListingSettings = {
  insurance: [],
  accessibility: [],
  open24h: false,
  emergency24h: false,
  ambulanceAvailable: false,
  emergencyIntakeEnabled: false,
  acceptsOnlineBooking: false,
};

export function parseDirectorySettings(
  data: Prisma.JsonValue | null | undefined,
): DirectorySettings {
  const raw = data as { listings?: Record<string, BranchListingSettings | undefined> } | null;
  const listings: Record<string, BranchListingSettings> = {};
  for (const [branchId, cfg] of Object.entries(raw?.listings ?? {})) {
    if (!cfg || typeof cfg !== 'object') continue;
    listings[branchId] = {
      ...DEFAULT_BRANCH_LISTING_SETTINGS,
      ...cfg,
      summary: cfg.summary ?? null,
      description: cfg.description ?? null,
      address: cfg.address ?? null,
      county: cfg.county ?? null,
      town: cfg.town ?? null,
      phone: cfg.phone ?? null,
      email: cfg.email ?? null,
      website: cfg.website ?? null,
      hours: cfg.hours && typeof cfg.hours === 'object' ? cfg.hours : undefined,
      departments:
        Array.isArray(cfg.departments) && cfg.departments.length > 0
          ? cfg.departments
          : undefined,
      insurance: Array.isArray(cfg.insurance) ? cfg.insurance : [],
      accessibility: Array.isArray(cfg.accessibility) ? cfg.accessibility : [],
      services: Array.isArray(cfg.services) ? cfg.services : [],
      open24h: cfg.open24h ?? false,
      emergency24h: cfg.emergency24h ?? false,
      ambulanceAvailable: cfg.ambulanceAvailable ?? false,
      emergencyIntakeEnabled: cfg.emergencyIntakeEnabled ?? false,
      acceptsOnlineBooking: cfg.acceptsOnlineBooking ?? false,
      feeNote: cfg.feeNote ?? undefined,
      locationLat: cfg.locationLat ?? null,
      locationLng: cfg.locationLng ?? null,
    };
  }
  return { listings };
}

/**
 * Sanitized view served to anonymous consumers. Called with the recorded
 * distance when available (nearby/search results); slugs are matched against
 * the pre-built profile/POST map in the service.
 */
export function serializePublicListing(row: {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  address: string | null;
  county: string | null;
  town: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  timezone: string;
  hours: Prisma.JsonValue | null;
  departments: Prisma.JsonValue | null;
  insurance: string[];
  accessibility: string[];
  services: Prisma.JsonValue | null;
  feeNote: Prisma.JsonValue | null;
  open24h: boolean;
  emergency24h: boolean;
  ambulanceAvailable: boolean;
  emergencyIntakeEnabled: boolean;
  acceptsOnlineBooking: boolean;
  emergencyIntakeIndex: number | null;
  locationLat: number | null;
  locationLng: number | null;
  verificationStatus: string;
  partner: boolean;
}, opts?: { distanceKm?: number | null }) {
  const departments = safeJsonArray(row.departments);
  const services = safeJsonArray(row.services);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    address: row.address,
    county: row.county,
    town: row.town,
    phone: row.phone,
    email: row.email,
    website: row.website,
    timezone: row.timezone,
    hours: safeJsonObject(row.hours),
    departments,
    insurance: row.insurance ?? [],
    accessibility: row.accessibility ?? [],
    services,
    open24h: row.open24h,
    emergency24h: row.emergency24h,
    ambulanceAvailable: row.ambulanceAvailable,
    emergencyIntakeEnabled: row.emergencyIntakeEnabled,
    acceptsOnlineBooking: row.acceptsOnlineBooking,
    emergencyIntakeIndex: row.emergencyIntakeIndex,
    feeNote: safeJsonObject(row.feeNote),
    waitEstimateMinutes: null,
    verification: row.verificationStatus,
    partner: row.partner,
    ...(opts?.distanceKm !== undefined &&
    opts.distanceKm !== null &&
    row.locationLat !== null &&
    row.locationLng !== null
      ? { distanceKm: round(opts.distanceKm, 2) }
      : {}),
    ...(row.locationLat !== null && row.locationLng !== null
      ? { location: { lat: row.locationLat, lng: row.locationLng } }
      : {}),
  };
}

function safeJsonArray(v: Prisma.JsonValue | null): unknown[] {
  return Array.isArray(v) ? v : [];
}

function safeJsonObject(v: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}