/**
 * Public facility directory.
 *
 * Shared by `/facilities` (client search) and the `/request` intake page
 * (server-side select), both of which read `GET /public/facilities/search`.
 *
 * The exported document does not model this endpoint's body (the response typed
 * `unknown`, and the `q` query parameter is absent even though the live API
 * honours it), so the shape here is asserted against the running API and pinned
 * structurally by `extractListingItems`. A drifted body fails into
 * "directory unavailable", never into a directory that looks empty.
 */
export interface PublicFacilityListing {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly summary?: string | null;
  readonly address?: string | null;
  readonly town?: string | null;
  readonly county?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly website?: string | null;
  readonly timezone?: string | null;
  readonly feeNote?: string | null;
  readonly open24h?: boolean;
  readonly emergency24h?: boolean;
  readonly ambulanceAvailable?: boolean;
  readonly emergencyIntakeEnabled?: boolean;
  readonly acceptsOnlineBooking?: boolean;
  readonly waitEstimateMinutes?: number | null;
  readonly hours?: Record<string, unknown> | null;
}

/**
 * Facets a searcher can narrow the directory by.
 *
 * These are the live API's own fields (verified against a running API, not the
 * partial document — which fabricated a `type` enum that does not exist
 * upstream). The server does the free-text query; facets apply client-side over
 * the returned directory because the API exposes no facet parameter.
 */
export const FACILITY_FACETS = ['open24h', 'emergency24h', 'ambulanceAvailable'] as const;
export type FacilityFacet = (typeof FACILITY_FACETS)[number];

export function filterByFacets(
  items: readonly PublicFacilityListing[],
  active: readonly FacilityFacet[],
): readonly PublicFacilityListing[] {
  if (active.length === 0) return items;
  return items.filter((item) => active.every((facet) => item[facet] === true));
}

/**
 * Reads a directory envelope.
 *
 * The live contract is `{ success: true, data: […] }` — a flat array, unlike the
 * partial document's `{ data: { items, total } }`. Returns `null` when the body
 * is not a happy success envelope; a response that has drifted must fail into
 * "directory unavailable", not read as an empty directory.
 */
export function extractListingItems(
  body: unknown,
): { ok: true; items: readonly PublicFacilityListing[] } | { ok: false } {
  if (!body || typeof body !== 'object') return { ok: false };
  const record = body as { success?: unknown; data?: unknown };
  if (record.success !== true) return { ok: false };
  if (!Array.isArray(record.data)) return { ok: false };

  const items = record.data.filter((item): item is PublicFacilityListing => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Record<string, unknown>;
    return typeof candidate.slug === 'string' && typeof candidate.name === 'string';
  });

  // A valid envelope with unusable rows is a broken response, not a finding of
  // nothing. An *empty* array, by contrast, is a genuine zero-result search.
  if (items.length !== record.data.length) return { ok: false };
  return { ok: true, items };
}