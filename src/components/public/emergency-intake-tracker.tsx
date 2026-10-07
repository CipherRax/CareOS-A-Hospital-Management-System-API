'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field, Input, controlVariants } from '@/components/ui/field';
import { api } from '@/api/client';
import type { components } from '@/api/schema';
import { unwrapForTest } from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';

/**
 * Public emergency intake tracker.
 *
 * Built against `POST /public/emergency-requests/track` from the live careOS API
 * (`/request`'s receipt issues the `trackingToken` this screen is keyed by — the
 * reference is for talking to a person, the token is what proves the request is
 * the caller's).
 *
 * The API composes the caller-facing copy itself — `statusLabel`, `message`,
 * `disclaimer`, the national `numbers` — so this screen renders the API's words
 * verbatim rather than translating status values that could drift.
 *
 * Three rules, all contract-driven:
 *
 * 1. **The token is a secret.** It is never persisted to storage, never placed in
 *    a URL (the form submits a POST body, so it cannot leak into history or a
 *    referrer), and it is cleared from view when the result renders.
 * 2. **Errors are mapped by code.** The API's diagnostic `message` is never
 *    rendered; each error code maps to a sentence a member of the public can act
 *    on, and an unknown code gets a plain "try again" rather than an invention.
 * 3. **No PHI.** The response is the caller's own reference, a status label,
 *    caller guidance, the facility's public details and national emergency
 *    numbers. None of it is stored.
 */

type TrackDto = components['schemas']['TrackEmergencyRequestDto'];

/** Shape of the track 200 `data`, per the live `trackPublic` service method. */
interface TrackingResult {
  readonly referenceNumber: string;
  readonly status: string;
  readonly receivedAt?: string | null;
  readonly statusLabel?: string | null;
  readonly message?: string | null;
  readonly facility?: { readonly name?: string | null; readonly phone?: string | null } | null;
  readonly numbers?: ReadonlyArray<{
    readonly purpose?: string | null;
    readonly label?: string | null;
    readonly phone?: string | null;
    readonly hours?: string | null;
  }> | null;
  readonly guidance?: string | null;
  readonly disclaimer?: string | null;
}

/**
 * The export types the track 200 body as `unknown`, so the response is vetted in
 * code. A body without the two load-bearing fields is not a tracking result, and
 * must not be rendered as one.
 */
function normaliseTracking(data: unknown): TrackingResult | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.referenceNumber !== 'string' || typeof record.status !== 'string') return null;
  return record as unknown as TrackingResult;
}

export function EmergencyIntakeTracker() {
  const t = useTranslations('track');
  const locale = useLocale();
  const formId = useId();

  const [token, setToken] = useState('');
  const [problem, setProblem] = useState<string | undefined>();

  const submit = useMutation({
    mutationFn: async () => {
      const result = await api.POST('/public/emergency-requests/track', {
        body: { token: token.trim() } satisfies TrackDto,
      });
      const envelope = await unwrapForTest<unknown>(result);
      const value = normaliseTracking(envelope.data);
      if (!value) {
        // A distinguishable failure so the screen can fall to the honest generic
        // message rather than rendering nothing at all.
        throw { code: 'INTERNAL_ERROR', status: 200, resolved: null } satisfies QueryError;
      }
      return value;
    },
  });

  const result = submit.data;
  const error = submit.error as unknown as QueryError | undefined;

  if (result) {
    return (
      <section aria-labelledby={`${formId}-result`} className="max-w-2xl">
        <h2 id={`${formId}-result`} className="text-public-heading font-semibold text-primary">
          {t('resultTitle')}
        </h2>

        {/* The status in the API's own words — never our summary of it. */}
        {result.statusLabel ? (
          <p className="mt-4">
            <span className="block text-public-caption uppercase tracking-wide text-tertiary">
              {t('statusLabel')}
            </span>
            <span className="mt-1 block text-public-heading font-semibold text-primary">
              {result.statusLabel}
            </span>
          </p>
        ) : null}

        {/* The action message the API chose for this state, verbatim. */}
        {result.message ? (
          <p className="mt-3 text-public-body text-primary">{result.message}</p>
        ) : null}

        {/* The reference stays selectable: it is what a caller quotes to a person. */}
        <p className="mt-5 rounded-lg border border-border bg-surface px-4 py-4">
          <span className="block text-public-caption uppercase tracking-wide text-tertiary">
            {t('referenceLabel')}
          </span>
          <span className="mt-1 block select-all font-mono text-public-heading font-semibold text-primary">
            {result.referenceNumber}
          </span>
          {result.receivedAt ? (
            <span className="mt-1 block text-public-caption text-tertiary">
              {t('receivedLabel')}{' '}
              <ReceivedAt iso={result.receivedAt} locale={locale} fallback={t('receivedUnknown')} />
            </span>
          ) : null}
        </p>

        {result.facility?.name ? (
          <p className="mt-4">
            <span className="block text-public-caption uppercase tracking-wide text-tertiary">
              {t('facilityLabel')}
            </span>
            <span className="mt-1 block text-public-body font-medium text-primary">
              {result.facility.name}
            </span>
            {result.facility.phone ? (
              <span className="mt-1 block text-public-body">
                <a className="text-brand underline underline-offset-2" href={`tel:${result.facility.phone.replace(/\s+/g, '')}`}>
                  {result.facility.phone}
                </a>
              </span>
            ) : null}
          </p>
        ) : null}

        {result.numbers && result.numbers.length > 0 ? (
          <div className="mt-5">
            <h3 className="text-public-caption uppercase tracking-wide text-tertiary">
              {t('numbersTitle')}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {result.numbers.map((entry, index) => (
                <li key={index}>
                  {entry.label ? (
                    <span className="block text-public-body font-medium text-primary">
                      {entry.label}
                    </span>
                  ) : null}
                  {entry.phone ? (
                    <a className="text-brand underline underline-offset-2" href={`tel:${entry.phone.replace(/\s+/g, '')}`}>
                      {entry.phone}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.guidance ? (
          <p className="mt-4 text-public-body text-secondary">{result.guidance}</p>
        ) : null}

        <p className="mt-5 text-public-small text-secondary">{t('keepToken')}</p>
        {result.disclaimer ? (
          <p className="mt-2 text-public-caption text-tertiary">{result.disclaimer}</p>
        ) : null}

        <Button
          className="mt-6"
          variant="secondary"
          onClick={() => {
            // The token was a secret on a possibly shared machine: clear it from
            // the field so a half-read screen cannot resubmit it by accident.
            setToken('');
            submit.reset();
          }}
        >
          {t('another')}
        </Button>
      </section>
    );
  }

  return (
    <form
      noValidate
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        const value = token.trim();
        // A short entry is almost certainly a partial paste, and each guess costs
        // a rate-limited attempt. The API's own validation would catch it, but it
        // should not have to.
        if (value.length < 8) {
          setProblem(t('errors.required'));
          return;
        }
        setProblem(undefined);
        submit.mutate();
      }}
      className="flex max-w-2xl flex-col gap-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${formId}-title`} className="text-public-heading font-semibold text-primary">
          {t('title')}
        </h2>
        <p className="text-public-body text-secondary">{t('intro')}</p>
      </div>

      {/* A submission-level error sits above the form and is announced, so it is
          reached before the field. The API's own `message` is never rendered. */}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-critical px-4 py-3 text-public-body text-status-critical"
        >
          {errorCodeMessage(error, t)}
        </p>
      ) : null}

      <Field
        id={`${formId}-token`}
        label={t('tokenLabel')}
        hint={t('tokenHint')}
        error={problem}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Input
            id={controlId}
            name="trackingToken"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          />
        )}
      </Field>

      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" disabled={submit.isPending}>
          {submit.isPending ? t('searching') : t('submit')}
        </Button>
        <p className="text-public-caption text-tertiary">{t('urgentNote')}</p>
      </div>
    </form>
  );
}

function ReceivedAt({
  iso,
  locale,
  fallback,
}: {
  iso: string;
  locale: string;
  fallback: string;
}) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return <span>{fallback}</span>;
  }
  const label = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
  return <time dateTime={iso}>{label}</time>;
}

/**
 * Maps an error code to a sentence a member of the public can act on.
 *
 * Kept out of the component body because it is a lookup, not logic, and because
 * the diagnostic `message` the API returns must never reach a screen.
 */
function errorCodeMessage(error: QueryError, t: (key: string) => string): string {
  switch (error.code) {
    case 'RESOURCE_NOT_FOUND':
      return t('errors.notFound');
    case 'RATE_LIMITED':
      return t('errors.rateLimited');
    case 'VALIDATION_ERROR':
    case 'UNPROCESSABLE_ENTITY':
      return t('errors.validation');
    case 'SERVICE_UNAVAILABLE':
    case 'NETWORK_ERROR':
      return t('errors.unavailable');
    default:
      return t('errors.generic');
  }
}