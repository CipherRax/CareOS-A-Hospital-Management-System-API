'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, controlVariants } from '@/components/ui/field';
import { api } from '@/api/client';
import type { components } from '@/api/schema';
import { unwrapForTest } from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';

/**
 * Public emergency intake request.
 *
 * Built against `POST /public/emergency-requests` from the real careOS API
 * (re-aligned here: the partial document's `facilityId`/`patientName`/
 * `consentToContact` body and `{ id, reference, status }` receipt were a guess;
 * the live contract sends `slug` + caller fields and returns
 * `{ request: { id, referenceNumber, trackingToken }, contact, consentVersion }`).
 * Three rules shape everything here, and all three come from the contract rather
 * than from taste:
 *
 * 1. **This is not triage.** The spec is explicit: "The caller receives a
 *    reference to track with, not a clinical assessment. The UI must not present a
 *    response as triage." The `category` the API asks for is the caller's own
 *    plain-language description of the situation, and the label says so — picking
 *    one does not queue anyone or assess severity.
 *
 * 2. **Consent is the API's act, not a checkbox.** The old `consentToContact`
 *    field is gone; the live request carries `consentVersion` and is recorded
 *    server-side. There is therefore no consent checkbox to pre-tick or skip.
 *
 * 3. **The token is the secret.** Tracking and cancellation
 *    (`/public/emergency-requests/track` and `/cancel`) are keyed by the
 *    `trackingToken`, not the reference. The reference is for talking to a person;
 *    the token is what proves the request is yours. Both are shown, and the token
 *    is called out as something to keep private.
 *
 * PHI note: nothing here is persisted client-side, put in a URL, or logged. A
 * submitted request goes straight to the API in the request body and the caller
 * fields are cleared on success.
 */

type SubmitDto = components['schemas']['SubmitEmergencyRequestDto'];
type RequestCategory = NonNullable<SubmitDto['category']>;
type ContactPreference = NonNullable<SubmitDto['preferredContact']>;

export const REQUEST_CATEGORIES: readonly RequestCategory[] = [
  'NOT_SURE',
  'BREATHING_DIFFICULTY',
  'SEVERE_INJURY',
  'UNCONSCIOUS',
  'CHEST_PAIN',
  'HEAVY_BLEEDING',
  'OTHER',
];

/** Shape of the 201 `data` per the exported contract's own example. */
interface EmergencyRequestReceipt {
  readonly request: {
    readonly id: string;
    readonly referenceNumber: string;
    readonly trackingToken: string;
  };
  readonly contact?: string | null;
  readonly consentVersion?: string | null;
}

type Facilities = ReadonlyArray<{ slug: string; name: string }>;

export function EmergencyRequestForm({
  facilities,
  initialFacilitySlug,
}: {
  facilities: Facilities;
  initialFacilitySlug?: string;
}) {
  const t = useTranslations('intake');
  const locale = useLocale();
  const formId = useId();

  const [slug, setSlug] = useState(initialFacilitySlug ?? '');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<RequestCategory | ''>('');
  const [forSelf, setForSelf] = useState<'true' | 'false' | ''>('');
  const [peopleCount, setPeopleCount] = useState('1');
  const [preferredContact, setPreferredContact] = useState<ContactPreference | ''>('');
  // One idempotency key per form mount: a retried submission must not create a
  // duplicate request upstream.
  const clientRequestIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  /**
   * Field-level validation, kept out of the component.
   *
   * The server validates too, and its answer wins — this exists so an obviously
   * incomplete request does not consume a rate-limited submission and then come
   * back with a mapped error. `noValidate` is set below so the browser's own
   * bubbles do not compete with these messages.
   */
  function validate() {
    const problems: Partial<
      Record<
        'slug' | 'callerName' | 'callerPhone' | 'description' | 'category' | 'forSelf' |
          'peopleCount' | 'preferredContact',
        string
      >
    > = {};
    if (!slug) problems.slug = t('errors.facility');
    if (!callerName.trim()) problems.callerName = t('errors.name');
    if (!callerPhone.trim()) problems.callerPhone = t('errors.phone');
    else if (!/^[+()\d][\d\s()+.-]{5,}$/.test(callerPhone.trim()))
      problems.callerPhone = t('errors.phoneFormat');
    if (!description.trim()) problems.description = t('errors.description');
    else if (description.trim().length < 10) problems.description = t('errors.descriptionShort');
    if (!category) problems.category = t('errors.category');
    if (!forSelf) problems.forSelf = t('errors.forSelf');
    if (!/^\d+$/.test(peopleCount) || Number(peopleCount) < 1)
      problems.peopleCount = t('errors.peopleCount');
    else if (Number(peopleCount) > 999) problems.peopleCount = t('errors.peopleCount');
    if (!preferredContact) problems.preferredContact = t('errors.preferredContact');
    return problems;
  }

  const [problems, setProblems] = useState<ReturnType<typeof validate>>({});

  const submit = useMutation({
    mutationFn: async () => {
      const body: SubmitDto = {
        slug,
        callerName: callerName.trim(),
        callerPhone: callerPhone.trim(),
        description: description.trim(),
        category: category || undefined,
        forSelf: forSelf === 'true',
        peopleCount: Number(peopleCount),
        preferredContact: preferredContact || undefined,
        locale,
        clientRequestId: clientRequestIdRef.current,
      };
      const result = await api.POST('/public/emergency-requests', { body });
      return unwrapForTest<EmergencyRequestReceipt>(result);
    },
    onSuccess: () => {
      // Cleared so a shared or public machine does not keep the caller's details
      // on screen after submission. The facility stays — it is not PHI and the
      // next request is likely to the same place.
      setCallerName('');
      setCallerPhone('');
      setDescription('');
      setCategory('');
      setForSelf('');
      setPeopleCount('1');
      setPreferredContact('');
    },
  });

  const receipt = submit.data?.data;
  // The mutation rejects with `QueryError` by construction in `unwrap`, but React
  // Query types `error` as `Error`; the cast goes through `unknown` because the two
  // do not overlap.
  const error = submit.error as unknown as QueryError | undefined;

  if (receipt) {
    return (
      <section aria-labelledby={`${formId}-done`} className="max-w-2xl">
        <h2 id={`${formId}-done`} className="text-public-heading font-semibold text-primary">
          {t('receipt.title')}
        </h2>
        <p className="mt-2 text-public-body text-secondary">{t('receipt.body')}</p>

        {/* The reference is the only thing the caller needs to act on, so it is
            the largest element on the page and selectable. */}
        <p className="mt-5 rounded-lg border border-border bg-surface px-4 py-4">
          <span className="block text-public-caption uppercase tracking-wide text-tertiary">
            {t('receipt.referenceLabel')}
          </span>
          <span className="mt-1 block select-all font-mono text-public-heading font-semibold text-primary">
            {receipt.request.referenceNumber}
          </span>
        </p>

        {/* The tracking token is the secret that proves the request is the
            caller's (track/cancel are keyed by it). Shown and selectable, with its
            role stated — it is not the reference. */}
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-4">
          <span className="block text-public-caption uppercase tracking-wide text-tertiary">
            {t('receipt.trackingLabel')}
          </span>
          <span className="mt-1 block select-all font-mono text-public-body font-medium text-primary">
            {receipt.request.trackingToken}
          </span>
          <span className="mt-1 block text-public-caption text-tertiary">
            {t('receipt.trackingHint')}
          </span>
        </p>

        {/* No queue position, no wait estimate, no "a clinician will review this".
            Nothing here may imply the request has been assessed. */}
        <p className="mt-4 text-public-small text-secondary">{t('receipt.noAssessment')}</p>

        {/* Deliberately no "what happens next" list: it would be invented, and an
            invented next step in an emergency is the most damaging thing this
            screen could say. A tracking screen itself is future work — the
            endpoint exists upstream, the UI does not. */}
        <Button className="mt-6" variant="secondary" onClick={() => submit.reset()}>
          {t('receipt.another')}
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
        const found = validate();
        setProblems(found);
        if (Object.keys(found).length > 0) return;
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
          reached before the fields rather than after whatever the reader last
          touched. The API's own `message` is never rendered. */}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-critical px-4 py-3 text-public-body text-status-critical"
        >
          {errorCodeMessage(error, t)}
        </p>
      ) : null}

      <Field
        id={`${formId}-facility`}
        label={t('facility.label')}
        hint={t('facility.hint')}
        error={problems.slug}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Select
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          >
            <option value="">{t('facility.placeholder')}</option>
            {facilities.map((facility) => (
              <option key={facility.slug} value={facility.slug}>
                {facility.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id={`${formId}-name`} label={t('name.label')} error={problems.callerName} required>
        {({ controlId, describedBy, invalid }) => (
          <Input
            id={controlId}
            name="callerName"
            autoComplete="name"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={callerName}
            onChange={(event) => setCallerName(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          />
        )}
      </Field>

      <Field
        id={`${formId}-phone`}
        label={t('phone.label')}
        hint={t('phone.hint')}
        error={problems.callerPhone}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Input
            id={controlId}
            name="callerPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={callerPhone}
            onChange={(event) => setCallerPhone(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          />
        )}
      </Field>

      <Field
        id={`${formId}-category`}
        label={t('category.label')}
        hint={t('category.notTriage')}
        error={problems.category}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Select
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={category}
            onChange={(event) => setCategory(event.target.value as RequestCategory | '')}
            className={controlVariants({ controlSize: 'public' })}
          >
            <option value="">{t('category.placeholder')}</option>
            {REQUEST_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id={`${formId}-self`} label={t('forSelf.label')} error={problems.forSelf} required>
        {({ controlId, describedBy, invalid }) => (
          <Select
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={forSelf}
            onChange={(event) => {
              setForSelf(event.target.value as 'true' | 'false' | '');
              if (event.target.value === 'true') setPeopleCount('1');
            }}
            className={controlVariants({ controlSize: 'public' })}
          >
            <option value="">{t('forSelf.placeholder')}</option>
            <option value="true">{t('forSelf.yes')}</option>
            <option value="false">{t('forSelf.no')}</option>
          </Select>
        )}
      </Field>

      <Field
        id={`${formId}-people`}
        label={t('peopleCount.label')}
        hint={t('peopleCount.hint')}
        error={problems.peopleCount}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Input
            id={controlId}
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            step={1}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={peopleCount}
            onChange={(event) => setPeopleCount(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          />
        )}
      </Field>

      <Field
        id={`${formId}-contact`}
        label={t('preferredContact.label')}
        error={problems.preferredContact}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Select
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={preferredContact}
            onChange={(event) => setPreferredContact(event.target.value as ContactPreference | '')}
            className={controlVariants({ controlSize: 'public' })}
          >
            <option value="">{t('preferredContact.placeholder')}</option>
            <option value="PHONE">{t('preferredContact.PHONE')}</option>
            <option value="SMS">{t('preferredContact.SMS')}</option>
          </Select>
        )}
      </Field>

      <Field
        id={`${formId}-description`}
        label={t('description.label')}
        hint={t('description.hint')}
        error={problems.description}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Textarea
            id={controlId}
            name="description"
            rows={5}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          />
        )}
      </Field>

      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" disabled={submit.isPending}>
          {submit.isPending ? t('submitting') : t('submit')}
        </Button>
        {/* Named deliberately: no "urgent" or "immediate" wording, because nothing
            here establishes urgency and the word would be read as a promise. */}
        <p className="text-public-caption text-tertiary">{t('urgentNotice')}</p>
      </div>
    </form>
  );
}

/**
 * Maps an error code to a sentence a member of the public can act on.
 *
 * Kept out of the component body because it is a lookup, not logic, and because the
 * diagnostic `message` the API returns must never reach a screen.
 */
function errorCodeMessage(error: QueryError, t: (key: string) => string): string {
  switch (error.code) {
    case 'RATE_LIMITED':
      return t('errors.rateLimited');
    case 'SERVICE_UNAVAILABLE':
      return t('errors.unavailable');
    case 'VALIDATION_ERROR':
    case 'UNPROCESSABLE_ENTITY':
      return t('errors.serverValidation');
    case 'FACILITY_NOT_ACCEPTING_REQUESTS':
      return t('errors.facilityNotAccepting');
    default:
      return t('errors.generic');
  }
}