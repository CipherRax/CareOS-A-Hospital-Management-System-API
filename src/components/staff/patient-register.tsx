'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { CheckCircle2, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState } from '@/components/clinical/empty-state';
import {
  candidatesFromRegisterError,
  useConfirmNotDuplicate,
  useRegisterPatient,
  type DuplicateCandidate,
  type RegisterPatientInput,
} from '@/lib/data/queries';

/**
 * Walk-in registration wizard (F2).
 *
 * The only interstitial between identity capture and a finished registration is
 * the duplicate check. The API answers a match with 409 `POSSIBLE_DUPLICATE`
 * carrying candidate ids; this screen turns that into a comparison, and the two
 * exits are deliberately unlike a merge:
 *
 *  - "Open this record" leaves for the existing patient.
 *  - "This is a different person" records a reason on the candidate
 *    (`confirm-not-duplicate`) and only then re-submits the registration with
 *    `confirmDuplicate` + the same reason.
 *
 * There is deliberately no merge control here — merging is the records office's
 * tool, not reception's.
 *
 * The data comes from the patient registry fixtures, marked EXAMPLE.
 */

interface FormState {
  firstName: string;
  lastName: string;
  otherNames: string;
  dateOfBirth: string;
  sex: '' | 'MALE' | 'FEMALE' | 'OTHER';
  phone: string;
  email: string;
  county: string;
  town: string;
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  otherNames: '',
  dateOfBirth: '',
  sex: '',
  phone: '',
  email: '',
  county: '',
  town: '',
};

type FormErrors = Partial<Record<'firstName' | 'lastName' | 'dateOfBirth', string>>;

export function RegisterPatientScreen() {
  const t = useTranslations('patients');
  const common = useTranslations('common');
  const register = useTranslations('patients.register');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [candidates, setCandidates] = useState<readonly DuplicateCandidate[]>([]);
  const [confirmReason, setConfirmReason] = useState('');
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; patientNumber: string } | null>(null);
  const [submitError, setSubmitError] = useState<{ title: string; body: string } | null>(null);

  const save = useRegisterPatient();
  const confirmNotDuplicate = useConfirmNotDuplicate();

  function setField(key: keyof FormState, value: string | FormState['sex']) {
    setForm((current) => ({ ...current, [key]: value }));
    setSubmitError(null);
    setCandidates([]);
    setReasonFor(null);
    setConfirmReason('');
  }

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!form.firstName.trim()) next.firstName = register('firstNameRequired');
    if (!form.lastName.trim()) next.lastName = register('lastNameRequired');
    const dob = form.dateOfBirth;
    if (dob) {
      const parsed = new Date(`${dob}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) next.dateOfBirth = register('invalidDob');
      else if (parsed.getTime() > Date.now()) next.dateOfBirth = register('futureDob');
    } else {
      next.dateOfBirth = register('invalidDob');
    }
    return next;
  }

  function toPayload(overrides?: { confirmDuplicate: boolean; duplicateConfirmReason?: string }) {
    return {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      otherNames: form.otherNames.trim() || null,
      dateOfBirth: form.dateOfBirth || null,
      sex: form.sex || undefined,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      county: form.county.trim() || null,
      town: form.town.trim() || null,
      ...overrides,
    } satisfies RegisterPatientInput;
  }

  function submit() {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitError(null);
    save.mutate(toPayload(), {
      onError: (error) => {
        const found = candidatesFromRegisterError(error);
        if (error.code === 'POSSIBLE_DUPLICATE' && found.length > 0) {
          setCandidates(found);
          return;
        }
        setSubmitError({
          title: error.resolved?.titleKey ?? 'error.internal.title',
          body: error.resolved?.messageKey ?? 'error.internal.body',
        });
      },
      onSuccess: (data) => {
        setCreated(stringifyPatientNumber(data));
      },
    });
  }

  function finishDuplicateReview(candidateId: string, reason: string) {
    if (!reason.trim()) {
      setReasonFor(candidateId);
      return;
    }
    setSubmitError(null);
    confirmNotDuplicate.mutate(
      { id: candidateId, reason: reason.trim() },
      {
        onSuccess: () => {
          // The candidate is now recorded as reviewed; re-submit the registration
          // with confirmation of the check, exactly as reception would.
          save.mutate(
            toPayload({ confirmDuplicate: true, duplicateConfirmReason: reason.trim() }),
            {
              onError: (error) => {
                const found = candidatesFromRegisterError(error);
                if (found.length > 0) setCandidates(found);
                else
                  setSubmitError({
                    title: error.resolved?.titleKey ?? 'error.internal.title',
                    body: error.resolved?.messageKey ?? 'error.internal.body',
                  });
              },
              onSuccess: (data) => {
                setCreated(stringifyPatientNumber(data));
              },
            },
          );
        },
        onError: (error) => {
          setSubmitError({
            title: error.resolved?.titleKey ?? 'error.internal.title',
            body: error.resolved?.messageKey ?? 'error.internal.body',
          });
        },
      },
    );
  }

  if (created) {
    const numberKnown = created.patientNumber.length > 0;
    return (
      <div className="flex flex-col gap-4 px-6 py-6">
        <h1 className="text-heading font-semibold text-primary">{register('registered')}</h1>
        <EmptyState
          headingLevel={2}
          icon={CheckCircle2}
          title={register('registered')}
          description={register('registeredBody', {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            patientNumber: created.patientNumber,
          })}
          action={
            <div className="flex flex-wrap gap-2">
              {numberKnown && created.id.length > 0 ? (
                <Button asChild>
                  <Link href={`/patients/${created.id}`}>{register('viewRecord')}</Link>
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setCreated(null);
                  setCandidates([]);
                  setReasonFor(null);
                  setConfirmReason('');
                  setErrors({});
                }}
              >
                {register('registerAnother')}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-heading font-semibold text-primary">{register('title')}</h1>
        <p className="text-meta text-secondary">{register('intro')}</p>
      </header>

      {submitError ? <SectionError title={submitError.title} body={submitError.body} /> : null}

      {candidates.length > 0 ? (
        <DuplicatePanel
          candidates={candidates}
          reason={confirmReason}
          reasonFor={reasonFor}
          confirming={confirmNotDuplicate.isPending || save.isPending}
          onReasonChange={setConfirmReason}
          onReasonForChange={setReasonFor}
          onConfirm={(candidate) => finishDuplicateReview(candidate.patientId, confirmReason)}
        />
      ) : null}

      <section aria-labelledby="identity-title" className="flex flex-col gap-4">
        <h2 id="identity-title" className="text-heading-xs font-semibold text-primary">
          {register('identityTitle')}
        </h2>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field id="first-name" label={register('firstName')} required error={errors.firstName}>
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.firstName}
                onChange={(event) => setField('firstName', event.target.value)}
                autoComplete="given-name"
              />
            )}
          </Field>
          <Field id="last-name" label={register('lastName')} required error={errors.lastName}>
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.lastName}
                onChange={(event) => setField('lastName', event.target.value)}
                autoComplete="family-name"
              />
            )}
          </Field>
          <Field id="other-names" label={register('otherNames')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                value={form.otherNames}
                onChange={(event) => setField('otherNames', event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            id="date-of-birth"
            label={register('dob')}
            hint={register('dobHint')}
            required
            error={errors.dateOfBirth}
          >
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                invalid={invalid}
                type="date"
                value={form.dateOfBirth}
                onChange={(event) => setField('dateOfBirth', event.target.value)}
              />
            )}
          </Field>
          <Field id="sex" label={t('sex')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={form.sex}
                onChange={(event) => setField('sex', event.target.value as FormState['sex'])}
              >
                <option value="">—</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </Select>
            )}
          </Field>
          <Field id="phone" label={register('phoneOptional')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(event) => setField('phone', event.target.value)}
              />
            )}
          </Field>
          <Field id="email" label={register('email')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) => setField('email', event.target.value)}
              />
            )}
          </Field>
          <Field id="county" label={register('county')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                value={form.county}
                onChange={(event) => setField('county', event.target.value)}
                autoComplete="address-level1"
              />
            )}
          </Field>
          <Field id="town" label={register('town')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                value={form.town}
                onChange={(event) => setField('town', event.target.value)}
                autoComplete="address-level2"
              />
            )}
          </Field>

          <div className="flex items-start gap-2 sm:col-span-2 lg:col-span-3">
            <Button
              type="submit"
              size="lg"
              disabled={save.isPending || confirmNotDuplicate.isPending}
            >
              {save.isPending ? (
                register('submitting')
              ) : (
                <>
                  <UserPlus aria-hidden className="size-4" strokeWidth={1.5} />
                  {register('submit')}
                </>
              )}
            </Button>
            {reasonFor ? (
              <p className="text-caption text-status-critical">
                {register('notDuplicateReasonRequired')}
              </p>
            ) : null}
          </div>
          <p className="sr-only">{common('required')}</p>
        </form>
      </section>
    </div>
  );
}

function DuplicatePanel({
  candidates,
  reason,
  reasonFor,
  confirming,
  onReasonChange,
  onReasonForChange,
  onConfirm,
}: {
  candidates: readonly DuplicateCandidate[];
  reason: string;
  reasonFor: string | null;
  confirming: boolean;
  onReasonChange: (value: string) => void;
  onReasonForChange: (candidateId: string | null) => void;
  onConfirm: (candidate: DuplicateCandidate) => void;
}) {
  const register = useTranslations('patients.register');
  return (
    <section
      role="alert"
      aria-label={register('duplicateTitle')}
      className="flex flex-col gap-3 border border-status-warning bg-status-warning-bg px-4 py-4"
    >
      <h2 className="text-body font-semibold text-status-warning">{register('duplicateTitle')}</h2>
      <p className="text-meta text-secondary">
        {candidates.length === 1
          ? register('duplicateIntroPL')
          : register('duplicateIntroOther', { count: candidates.length })}
      </p>

      <ul className="flex flex-col gap-3">
        {candidates.map((candidate) => (
          <li
            key={candidate.patientId}
            className="flex flex-col gap-3 border border-border bg-surface p-4"
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              <span className="text-caption text-tertiary">{register('candName')}</span>
              <span className="col-span-1 text-meta text-primary">
                {candidate.firstName} {candidate.lastName}
              </span>
              <span className="text-caption text-tertiary">{register('candReference')}</span>
              <span className="font-mono text-meta text-primary">{candidate.patientNumber}</span>
              <span className="text-caption text-tertiary">{register('candDob')}</span>
              <span className="text-meta text-secondary">{candidate.dateOfBirth ?? '—'}</span>
              <span className="text-caption text-tertiary">{register('candPhone')}</span>
              <span className="text-meta text-secondary">{candidateReasons(candidate)}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link href={`/patients/${candidate.patientId}`}>{register('thisIsSame')}</Link>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={confirming}
                onClick={() =>
                  onReasonForChange(reasonFor === candidate.patientId ? null : candidate.patientId)
                }
              >
                {register('notDuplicate')}
              </Button>
            </div>

            {reasonFor === candidate.patientId ? (
              <div className="flex flex-col gap-2">
                <Field
                  id="dup-reason"
                  label={register('notDuplicateReason')}
                  hint={register('notDuplicateReasonHint')}
                >
                  {({ controlId, describedBy }) => (
                    <Textarea
                      id={controlId}
                      aria-describedby={describedBy}
                      value={reason}
                      onChange={(event) => onReasonChange(event.target.value)}
                      rows={2}
                    />
                  )}
                </Field>
                <div>
                  <Button
                    size="sm"
                    onClick={() => onConfirm(candidate)}
                    disabled={confirming || !reason.trim()}
                  >
                    {confirming ? register('notDuplicateSubmitting') : register('notDuplicate')}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function candidateReasons(candidate: DuplicateCandidate): string {
  const words: Record<string, string> = {
    MATCHED_NAME: 'Name',
    MATCHED_DATE_OF_BIRTH: 'Date of birth',
    MATCHED_PHONE: 'Phone',
  };
  const names = candidate.reasons.map((reasonToken) => words[reasonToken] ?? reasonToken);
  return names.length > 0 ? names.join(', ') : (candidate.dateOfBirth ?? 'Possible match');
}

function SectionError({ title, body }: { title: string; body: string }) {
  const err = useTranslations('error');
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 border border-status-critical bg-status-critical-bg px-4 py-3"
    >
      <h2 className="text-body font-semibold text-status-critical">{err(title)}</h2>
      <p className="text-meta text-secondary">{err(body)}</p>
    </div>
  );
}

function stringifyPatientNumber(data: unknown): { id: string; patientNumber: string } {
  if (data && typeof data === 'object') {
    const record = data as { id?: unknown; patientNumber?: unknown };
    return {
      id: typeof record.id === 'string' ? record.id : '',
      patientNumber: typeof record.patientNumber === 'string' ? record.patientNumber : '',
    };
  }
  // The create response should carry the assigned number. If a future API drifts,
  // fail to a placeholder rather than pretending a number exists.
  return { id: '', patientNumber: '' };
}
