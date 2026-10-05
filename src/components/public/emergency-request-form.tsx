'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/primitives';
import { Field, Input, Select, Textarea, controlVariants } from '@/components/ui/field';
import { api } from '@/api/client';
import { unwrapForTest } from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import { useTranslations } from 'next-intl';

/**
 * Public emergency intake request.
 *
 * The only screen in the app built against a fully documented endpoint, and the
 * only one a member of the public can reach. Two rules shape everything here, and
 * both come from the contract rather than from taste:
 *
 * 1. **This is not triage.** The spec is explicit: "The caller receives a
 *    reference to track with, not a clinical assessment. The UI must not present a
 *    response as triage." So nothing here asks the patient to self-assess their
 *    severity, nothing implies a queue position, and the receipt makes no promise
 *    about when anyone will be seen. A public that believes it has been assessed is
 *    worse for the patient than one that knows it has not.
 *
 * 2. **Consent is a real act.** `consentToContact` is `{ const: true }` and is not
 *    pre-ticked. Pre-ticked consent is not consent, and a checkbox that starts
 *    checked is the kind of detail that only surfaces in an audit.
 *
 * The form is also the one place a member of the public can be phoned, so the phone
 * field is validated as a phone number and nothing else — no strict length or format
 * gate that would reject a valid number written differently from the developer's.
 *
 * PHI note: nothing here is persisted client-side, put in a URL, or logged. A
 * submitted request goes straight to the API in the request body and the form is
 * cleared on success.
 */

type Facilities = ReadonlyArray<{ id: string; name: string }>;

export function EmergencyRequestForm({
  facilities,
  initialFacilityId,
}: {
  facilities: Facilities;
  initialFacilityId?: string;
}) {
  const t = useTranslations('intake');
  const formId = useId();

  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [facilityId, setFacilityId] = useState(initialFacilityId ?? '');
  const [consent, setConsent] = useState(false);

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
      Record<'facilityId' | 'patientName' | 'phone' | 'description' | 'consent', string>
    > = {};
    if (!facilityId) problems.facilityId = t('errors.facility');
    if (!patientName.trim()) problems.patientName = t('errors.name');
    if (!phone.trim()) problems.phone = t('errors.phone');
    else if (!/^[+()\d][\d\s()+.-]{5,}$/.test(phone.trim()))
      problems.phone = t('errors.phoneFormat');
    if (!description.trim()) problems.description = t('errors.description');
    else if (description.trim().length < 10) problems.description = t('errors.descriptionShort');

    // Consent is validated here, not after the fact. The body always carries
    // `consentToContact: true`, because the schema demands it — so anything that
    // does not block the send has quietly recorded consent the person never gave.
    if (!consent) problems.consent = t('consent.required');

    return problems;
  }

  const [problems, setProblems] = useState<ReturnType<typeof validate>>({});

  const submit = useMutation({
    mutationFn: async () => {
      const result = await api.POST('/public/emergency-requests', {
        body: {
          facilityId,
          patientName: patientName.trim(),
          phone: phone.trim(),
          description: description.trim(),
          consentToContact: true,
        },
      });
      return unwrapForTest<{ reference: string; status: string; createdAt: string }>(result);
    },
    onSuccess: () => {
      // Cleared so a shared or public machine does not keep the details on screen
      // after submission. The reference is the only thing retained.
      setPatientName('');
      setPhone('');
      setDescription('');
      setConsent(false);
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

        {/* The reference is the only thing the patient needs to act on, so it is
            the largest element on the page and selectable. */}
        <p className="mt-5 rounded-lg border border-border bg-surface px-4 py-4">
          <span className="block text-public-caption uppercase tracking-wide text-tertiary">
            {t('receipt.referenceLabel')}
          </span>
          <span className="mt-1 block select-all font-mono text-public-heading font-semibold text-primary">
            {receipt.reference}
          </span>
        </p>

        {/* No queue position, no wait estimate, no "a clinician will review this".
            Nothing here may imply the request has been assessed. */}
        <p className="mt-4 text-public-small text-secondary">{t('receipt.noAssessment')}</p>

        {/* Deliberately no "what happens next" list: it would be invented, and an
            invented next step in an emergency is the most damaging thing this
            screen could say. The tracking endpoint does not exist yet (GAP-008). */}
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
        error={problems.facilityId}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Select
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={facilityId}
            onChange={(event) => setFacilityId(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          >
            <option value="">{t('facility.placeholder')}</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id={`${formId}-name`} label={t('name.label')} error={problems.patientName} required>
        {({ controlId, describedBy, invalid }) => (
          <Input
            id={controlId}
            name="patientName"
            autoComplete="name"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={patientName}
            onChange={(event) => setPatientName(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          />
        )}
      </Field>

      <Field
        id={`${formId}-phone`}
        label={t('phone.label')}
        hint={t('phone.hint')}
        error={problems.phone}
        required
      >
        {({ controlId, describedBy, invalid }) => (
          <Input
            id={controlId}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={controlVariants({ controlSize: 'public' })}
          />
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

      {/* Not pre-checked, and the label says what will happen with the number. */}
      <CheckboxField
        label={t('consent.label')}
        description={t('consent.description')}
        checked={consent}
        onCheckedChange={(checked) => setConsent(checked === true)}
      />
      {problems.consent ? (
        <p role="alert" className="text-public-small text-status-critical">
          {problems.consent}
        </p>
      ) : null}

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
    default:
      return t('errors.generic');
  }
}
