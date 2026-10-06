'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/api/client';
import type { components } from '@/api/schema';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';

/**
 * Facility search.
 *
 * The public directory, searched against `GET /public/facilities`, which — unlike
 * almost everything else in the partial contract — genuinely supports `q` and
 * `type`. So this is real work against a documented endpoint, with one caveat kept
 * visible: `docs/limitations.md` records that every screen here is verified against
 * the stub, not the careOS API.
 *
 * Rules that shape the screen:
 *
 *  - **Nothing here is fabricated.** The phone numbers, addresses and names are the
 *    API's own published fields; the page adds contact details only where the API
 *    supplied them. No map links (coordinates do not exist in the contract), no
 *    invented hours.
 *  - **Status is a word.** A facility that returns `INACTIVE` is labelled "Closed"
 *    in text. A directory that filters out outages by colour would be read by the
 *    person who needs to turn up somewhere else.
 *  - **Every search state is spoken.** Searching, results, zero results and a
 *    directory that failed to load each announce themselves rather than leaving a
 *    silent input. The zero-result case especially: silence reads as "in progress".
 *  - **Stale responses cannot win.** The search debounces, and a response is only
 *    applied if it is the newest request issued. Without that, a slow answer to an
 *    older keystroke overwrites the result of the one the reader is looking at.
 */
export type Facility = components['schemas']['PublicFacility'];
type FacilityType = components['schemas']['FacilityType'];

export const FACILITY_TYPES: readonly FacilityType[] = [
  'GENERAL',
  'REFERRAL',
  'SPECIALIST',
  'CLINIC',
  'PRIMARY_CARE',
];

/**
 * Extracts the items array from a facilities envelope.
 *
 * Returns `null` when the body is not a happy success envelope. Deliberately
 * defensive rather than trusting the generated type: the contract is provisional
 * (see docs/api-contract-gaps.md), and a drifted body that happened to typecheck
 * must fail into the "directory unavailable" state, never into an empty search.
 */
export function extractItems(
  body: unknown,
): { ok: true; items: readonly Facility[] } | { ok: false } {
  if (!body || typeof body !== 'object') return { ok: false };
  const record = body as { success?: unknown; data?: { items?: unknown } };
  if (record.success !== true) return { ok: false };
  if (!Array.isArray(record.data?.items)) return { ok: false };

  const items = record.data.items.filter((item): item is Facility => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Partial<Facility>;
    return typeof candidate.id === 'string' && typeof candidate.name === 'string';
  });

  // A valid envelope with no usable rows is a broken response, not a finding of
  // nothing — an empty directory is not a state the API reports.
  if (items.length !== record.data.items.length) return { ok: false };
  return { ok: true, items };
}

export function FacilitySearch() {
  const t = useTranslations('facilities');

  const [query, setQuery] = useState('');
  const [type, setType] = useState<FacilityType | ''>('');
  const [refresh, setRefresh] = useState(0);
  const [phase, setPhase] = useState<'searching' | 'results' | 'unavailable'>('searching');
  const [items, setItems] = useState<readonly Facility[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    async function search() {
      setPhase('searching');
      const result = await api.GET('/public/facilities', {
        params: {
          query: {
            q: query.trim() || undefined,
            type: type || undefined,
          },
        },
      });
      // A response may land after a newer search was issued; only the newest may
      // paint, or a slow answer to an old keystroke overwrites the fresh one.
      if (requestId !== requestIdRef.current) return;
      if (!result.response.ok) {
        setPhase('unavailable');
        return;
      }
      const deduced = extractItems(result.data);
      if (!deduced.ok) {
        setPhase('unavailable');
        return;
      }
      setItems(deduced.items);
      setPhase('results');
    }

    // Debounced, but not by very much: a directory lookup is short, and a long
    // delay makes every keystroke feel like a separate search.
    const timer = setTimeout(search, 350);
    return () => {
      clearTimeout(timer);
      // Invalidates the in-flight request as well as the timer.
      requestIdRef.current += 1;
    };
    // `refresh` exists only to re-run this effect on demand (Submit / Try again).
  }, [query, type, refresh]);

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

          <Field id="facilities-type" label={t('typeLabel')}>
            {({ controlId, describedBy, invalid }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={type}
                onChange={(event) => setType(event.target.value as FacilityType | '')}
              >
                <option value="">{t('typeAll')}</option>
                {FACILITY_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`type${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

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
          <h2
            id="facilities-results"
            className="text-caption uppercase tracking-wide text-tertiary"
          >
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
                  <p className="text-caption text-secondary">{t(`type${facility.type}`)}</p>
                  {/* A word, because a red/green dot would vanish under tungsten
                      light and deuteranopia alike. */}
                  <p className="text-caption text-secondary">{t(`status${facility.status}`)}</p>
                </div>
                {facility.address ? (
                  <p className="text-caption text-tertiary">{facility.address}</p>
                ) : null}
                {facility.phone || facility.emergencyPhone ? (
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption">
                    {facility.phone ? (
                      <a
                        href={`tel:${facility.phone}`}
                        className="text-primary underline underline-offset-2"
                      >
                        {t('phone')}: {facility.phone}
                      </a>
                    ) : null}
                    {facility.emergencyPhone ? (
                      <a
                        href={`tel:${facility.emergencyPhone}`}
                        className="font-medium text-status-critical underline underline-offset-2"
                      >
                        {t('emergencyPhone')}: {facility.emergencyPhone}
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
