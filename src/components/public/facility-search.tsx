'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { CheckboxField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { publicEnv } from '@/lib/env';
import {
  FACILITY_FACETS,
  extractListingItems,
  filterByFacets,
  type FacilityFacet,
  type PublicFacilityListing,
} from '@/lib/data/facilities';

/**
 * Facility search.
 *
 * Queries `GET /public/facilities/search`, re-aligned to the real careOS API
 * contract. Two things about that contract are worth naming:
 *
 *  - **`type` is gone, and never existed.** The partial document described a
 *    `FacilityType` enum (`GENERAL`, `REFERRAL`, …) that the live API does not
 *    model; the real directory carries `open24h`, `emergency24h` and
 *    `ambulanceAvailable` booleans instead. The screen filters on those live
 *    fields.
 *  - **The `q` parameter is real but undocumented.** The exported OpenAPI types
 *    the search response as `unknown` and lists no query parameters, yet the
 *    running API does free-text search on `q`. Because the client cannot express
 *    an undocumented parameter through the generated types, this screen fetches
 *    plainly and validates the envelope structurally instead. That fetch is the
 *    only raw call in the app, and it is pinned by e2e tests and documented in
 *    docs/limitations.md.
 *
 * Rules that shape the screen:
 *
 *  - **Nothing here is fabricated.** Phone numbers, addresses and summaries are
 *    the API's own published fields; the page adds contact details only where the
 *    API supplied them. No map links (the `location` object is not rendered —
 *    coordinates in a public directory are a routing decision), no invented
 *    hours.
 *  - **Every search state is spoken.** Searching, results, zero results and a
 *    directory that failed to load each announce themselves rather than leaving a
 *    silent input.
 *  - **Stale responses cannot win.** The search debounces, and a response is only
 *    applied if it is the newest request issued.
 */
export type Facility = PublicFacilityListing;

export function FacilitySearch() {
  const t = useTranslations('facilities');

  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<readonly FacilityFacet[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [phase, setPhase] = useState<'searching' | 'results' | 'unavailable'>('searching');
  const [items, setItems] = useState<readonly Facility[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    async function search() {
      setPhase('searching');
      const q = query.trim();
      const url = `${publicEnv.apiBasePath}/public/facilities/search${
        q ? `?q=${encodeURIComponent(q)}` : ''
      }`;
      const response = await fetch(url, { credentials: 'same-origin' });
      // A response may land after a newer search was issued; only the newest may
      // paint, or a slow answer to an old keystroke overwrites the fresh one.
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        setPhase('unavailable');
        return;
      }
      const deduced = extractListingItems(await response.json());
      if (!deduced.ok) {
        setPhase('unavailable');
        return;
      }
      // Facets are client-side filters over the server's answer (see the module
      // note in src/lib/data/facilities.ts).
      setItems(filterByFacets(deduced.items, facets));
      setPhase('results');
    }

    // Debounced, but not by very much: a directory lookup is short, and a long
    // delay makes every keystroke feel like a separate search.
    const timer = setTimeout(search, 350);
    return () => {
      clearTimeout(timer);
      // Invalidates the in-flight response guard as well as the timer.
      requestIdRef.current += 1;
    };
    // `refresh` exists only to re-run this effect on demand (Submit / Try again).
  }, [query, facets, refresh]);

  function toggleFacet(facet: FacilityFacet, active: boolean) {
    setFacets((current) => (active ? [...current, facet] : current.filter((f) => f !== facet)));
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        role="search"
        className="max-w-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          setRefresh((value) => value + 1);
        }}
      >
        <div className="flex flex-col gap-4">
          <Field id="facilities-q" label={t('searchLabel')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                type="search"
                autoComplete="off"
                placeholder={t('searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-caption font-medium text-secondary">{t('facetGroup')}</legend>
            {FACILITY_FACETS.map((facet) => (
              <CheckboxField
                key={facet}
                label={t(`facet.${facet}`)}
                description={t(`facet.${facet}Hint`)}
                checked={facets.includes(facet)}
                onCheckedChange={(checked) => toggleFacet(facet, checked === true)}
              />
            ))}
          </fieldset>

          <p className="sr-only" role="status" aria-live="polite">
            {phase === 'searching' ? t('searching') : t('resultsCount', { count: items.length })}
          </p>
        </div>
      </form>

      {phase === 'unavailable' ? (
        <section
          aria-labelledby="facilities-unavailable"
          className="max-w-2xl border-l-2 border-border-strong pl-4"
        >
          <h2 id="facilities-unavailable" className="text-body font-semibold text-primary">
            {t('unavailableTitle')}
          </h2>
          <p className="mt-1 text-body text-secondary">{t('unavailableBody')}</p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t('retry')}
          </Button>
        </section>
      ) : null}

      {phase === 'results' && items.length === 0 ? (
        <section
          aria-labelledby="facilities-empty"
          className="max-w-2xl border-l-2 border-border-strong pl-4"
        >
          <h2 id="facilities-empty" className="text-body font-semibold text-primary">
            {t('emptyTitle')}
          </h2>
          <p className="mt-1 text-body text-secondary">{t('emptyBody')}</p>
        </section>
      ) : null}

      {phase === 'results' && items.length > 0 ? (
        <section aria-labelledby="facilities-results">
          <h2 id="facilities-results" className="text-caption uppercase tracking-wide text-tertiary">
            {t('facilityList')}
          </h2>
          <p className="mt-1 sr-only" role="status">
            {t('resultsCount', { count: items.length })}
          </p>
          <ul className="mt-3 flex flex-col border-t border-border">
            {items.map((facility) => (
              <li key={facility.id} className="flex flex-col gap-1 border-b border-border py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-body font-semibold text-primary">{facility.name}</h3>
                  {facility.town || facility.county ? (
                    <p className="text-caption text-secondary">
                      {[facility.town, facility.county].filter(Boolean).join(', ')}
                    </p>
                  ) : null}
                </div>
                {facility.summary ? (
                  <p className="text-caption text-tertiary">{facility.summary}</p>
                ) : null}
                {facility.address ? (
                  <p className="text-caption text-tertiary">{facility.address}</p>
                ) : null}
                {/* A word, not a colour: a green dot would vanish under tungsten
                    light and deuteranopia alike. These are the API's own booleans,
                    rendered only when set. */}
                {facility.phone ? (
                  <a
                    href={`tel:${facility.phone}`}
                    className="mt-1 text-primary underline underline-offset-2"
                  >
                    {t('phone')}: {facility.phone}
                  </a>
                ) : null}
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption">
                  {facility.open24h ? <span>{t('open24h')}</span> : null}
                  {facility.emergency24h ? <span>{t('emergency24h')}</span> : null}
                  {facility.ambulanceAvailable ? <span>{t('ambulanceAvailable')}</span> : null}
                  {facility.emergencyIntakeEnabled ? (
                    <span>{t('emergencyIntakeEnabled')}</span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}