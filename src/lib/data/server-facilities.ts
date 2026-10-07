import { cache } from 'react';

import { env } from '@/lib/env';
import { extractListingItems, type PublicFacilityListing } from '@/lib/data/facilities';

/**
 * Facility list, fetched on the server.
 *
 * Deliberately server-side rather than a client query, and that is the whole point
 * of it. The intake form cannot render without facilities — `slug` is a required
 * field — so a client fetch means a member of the public staring at an empty form
 * on a slow or poor connection, which is precisely when someone is most likely to
 * be reaching for this page. Server-side, the select is populated in the HTML that
 * arrives.
 *
 * Goes to `API_INTERNAL_URL` directly rather than through the `/api/v1` proxy: a
 * server component cannot call its own origin, and proxying a server fetch to
 * itself would be a pointless loop.
 *
 * `cache` deduplicates within a single render pass, so the layout and the page do
 * not each fetch it.
 *
 * Returns a discriminated result rather than throwing. An unreachable API on a
 * public emergency page must render an honest message, not a 500.
 */
export type FacilitiesResult =
  { readonly ok: true; readonly facilities: readonly PublicFacilityListing[] } | { readonly ok: false };

export const getPublicFacilities = cache(async (): Promise<FacilitiesResult> => {
  try {
    const response = await fetch(`${env.API_INTERNAL_URL}/public/facilities/search`, {
      // Short window: the published facility list changes rarely, and a stale list
      // would send someone to a closed site. No PHI in this request either way.
      next: { revalidate: 300 },
      headers: { accept: 'application/json' },
    });

    if (!response.ok) return { ok: false };

    const deduced = extractListingItems(await response.json());
    // `success: true` is checked rather than the status alone, matching `unwrap`
    // in queries.ts: a 2xx carrying an error body is an error.
    if (!deduced.ok) return { ok: false };

    return { ok: true, facilities: deduced.items };
  } catch {
    // Swallowed deliberately. The caller renders a service-unavailable message;
    // logging the failure body here risks putting an identifier in a log line.
    return { ok: false };
  }
});