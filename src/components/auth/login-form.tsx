'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, controlVariants } from '@/components/ui/field';
import { api } from '@/api/client';
import type { components } from '@/api/schema';
import { unwrapForTest } from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';

/**
 * Staff sign-in.
 *
 * Two steps, both posting the exact DTO the live API declares:
 *
 *  1. `/auth/login` with the `LoginDto`. The token pair never reaches this
 *     component: the same-origin proxy lifts it out of the response and into two
 *     HttpOnly cookies (see `src/app/api/v1/[...path]/route.ts`), so the screen
 *     only ever sees "session started" or an MFA challenge.
 *  2. When the account has a second factor, `/auth/mfa/verify` completes the
 *     challenge with either a TOTP code or a recovery code. The proxy treats
 *     this response exactly like login — the pair it returns is lifted into the
 *     cookies and stripped from the body the browser sees.
 *
 * Errors are mapped by code. The API's diagnostic `message` is never rendered.
 * An MFA challenge is short-lived: the verify phase offers a way back to the
 * credentials so a stale challenge is not a dead end.
 */
type LoginDto = components['schemas']['LoginDto'];
type MfaVerifyDto = components['schemas']['MfaVerifyDto'];

interface LoginPayload {
  sessionStarted: boolean;
  challengeToken: string | null;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const formId = useId();

  const [organizationId, setOrganizationId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // A field-level validation message (the API's own verdict comes back as the
  // submission-level error instead, and is never painted onto a field).
  const [fieldError, setFieldError] = useState<
    { field: 'organizationId' | 'email' | 'password'; message: string } | undefined
  >();
  // Non-null while the sign-in is parked on the second-factor step.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaFactor, setMfaFactor] = useState<'code' | 'recovery'>('code');
  const [secondFactor, setSecondFactor] = useState('');
  const [mfaFieldError, setMfaFieldError] = useState<string | undefined>();
  // A success envelope that fails the structural checks below still needs an
  // error to show; it has no `error` object for the code catalogue to read.
  const [envelopeError, setEnvelopeError] = useState<string | null>(null);

  const inChallenge = challengeToken !== null;

  const submit = useMutation({
    mutationFn: async (): Promise<LoginPayload> => {
      const result = await api.POST('/auth/login', {
        body: {
          organizationId: organizationId.trim(),
          email: email.trim(),
          password,
        } satisfies LoginDto,
      });
      // The proxy sanitised the response, but trust is still earned: the
      // challenge flag and its token are only believed when they have the right
      // shape.
      const envelope = await unwrapForTest<unknown>(result);
      const data =
        envelope.data && typeof envelope.data === 'object'
          ? (envelope.data as { mfaRequired?: unknown; challengeToken?: unknown })
          : {};
      const mfa = data.mfaRequired === true;
      return {
        sessionStarted: !mfa,
        challengeToken: mfa && typeof data.challengeToken === 'string' ? data.challengeToken : null,
      };
    },
    onSuccess: async (payload) => {
      if (payload.sessionStarted) {
        // The session cookie is live; drop the query's cached signed-out state
        // before landing the gate on the staff surface.
        await queryClient.invalidateQueries({ queryKey: ['session'] });
        router.push('/triage');
      } else if (payload.challengeToken) {
        setChallengeToken(payload.challengeToken);
        setMfaFieldError(undefined);
      } else {
        // `mfaRequired: true` without an accompanying token: a reply that is
        // neither a session nor a challenge this screen can answer.
        setEnvelopeError(t('errors.generic'));
      }
    },
  });

  const verify = useMutation({
    mutationFn: async (): Promise<LoginPayload> => {
      const result = await api.POST('/auth/mfa/verify', {
        body: {
          challengeToken: challengeToken as string,
          code: mfaFactor === 'code' ? secondFactor : undefined,
          recoveryCode: mfaFactor === 'recovery' ? secondFactor : undefined,
        } satisfies MfaVerifyDto,
      });
      const envelope = await unwrapForTest<unknown>(result);
      const data =
        envelope.data && typeof envelope.data === 'object'
          ? (envelope.data as { mfaRequired?: unknown; challengeToken?: unknown })
          : {};
      const mfa = data.mfaRequired === true;
      return {
        sessionStarted: !mfa,
        challengeToken: mfa && typeof data.challengeToken === 'string' ? data.challengeToken : null,
      };
    },
    onSuccess: async (payload) => {
      if (payload.sessionStarted) {
        await queryClient.invalidateQueries({ queryKey: ['session'] });
        router.push('/triage');
      } else if (payload.challengeToken) {
        // A chained factor: keep the phase open under the new challenge.
        setChallengeToken(payload.challengeToken);
        setSecondFactor('');
        setMfaFieldError(undefined);
        verify.reset();
      } else {
        setEnvelopeError(t('errors.generic'));
      }
    },
  });

  const headlineError = inChallenge
    ? verify.error
      ? verifyErrorCodeMessage(verify.error as unknown as QueryError, t)
      : envelopeError
    : submit.error
      ? errorCodeMessage(submit.error as unknown as QueryError, t)
      : envelopeError;

  function restartSignIn() {
    setChallengeToken(null);
    setSecondFactor('');
    setMfaFieldError(undefined);
    setEnvelopeError(null);
    verify.reset();
  }

  return (
    <form
      noValidate
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (inChallenge) {
          if (!challengeToken) return;
          if (mfaFactor === 'code') {
            if (!/^\d{6}$/.test(secondFactor)) {
              setMfaFieldError(t('mfaCodeError'));
              return;
            }
          } else if (!secondFactor.trim()) {
            setMfaFieldError(t('mfaRecoveryError'));
            return;
          }
          setMfaFieldError(undefined);
          setEnvelopeError(null);
          verify.mutate();
          return;
        }
        const org = organizationId.trim();
        const mail = email.trim();
        if (!org) {
          setFieldError({ field: 'organizationId', message: t('errors.organizationId') });
          return;
        }
        if (!mail) {
          setFieldError({ field: 'email', message: t('errors.email') });
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
          setFieldError({ field: 'email', message: t('errors.emailFormat') });
          return;
        }
        if (!password) {
          setFieldError({ field: 'password', message: t('errors.password') });
          return;
        }
        setFieldError(undefined);
        setEnvelopeError(null);
        submit.mutate();
      }}
      className="flex max-w-xl flex-col gap-6"
    >
      <h1 id={`${formId}-title`} className="text-public-heading font-semibold text-primary">
        {t('signInTitle')}
      </h1>
      <p className="text-public-body text-secondary">{t('signInIntro')}</p>

      {headlineError ? (
        <div role="alert" className="rounded-lg border border-status-critical bg-surface px-4 py-3">
          <p className="text-public-heading font-semibold text-status-critical">
            {t('errorHeading')}
          </p>
          <p className="mt-1 text-public-body text-status-critical">{headlineError}</p>
        </div>
      ) : null}

      {inChallenge ? (
        <>
          <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-public-body font-medium text-primary">{t('mfaChallengeTitle')}</p>
            <p className="mt-1 text-public-body text-secondary">
              {t('mfaSigningInAs', { email: email.trim() })}. {t('mfaChallengeBody')}
            </p>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-meta font-medium text-secondary">{t('mfaFactorLegend')}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-public-body text-primary">
                <input
                  type="radio"
                  name={`${formId}-factor`}
                  checked={mfaFactor === 'code'}
                  onChange={() => {
                    setMfaFactor('code');
                    setMfaFieldError(undefined);
                  }}
                  className="size-4 accent-brand"
                />
                {t('mfaSecurityCodeOption')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-public-body text-primary">
                <input
                  type="radio"
                  name={`${formId}-factor`}
                  checked={mfaFactor === 'recovery'}
                  onChange={() => {
                    setMfaFactor('recovery');
                    setMfaFieldError(undefined);
                  }}
                  className="size-4 accent-brand"
                />
                {t('mfaRecoveryOption')}
              </label>
            </div>
          </fieldset>

          {mfaFactor === 'code' ? (
            <Field
              id={`${formId}-code`}
              label={t('mfaCodeLabel')}
              hint={t('mfaCodeHint')}
              error={mfaFieldError}
            >
              {({ controlId, describedBy, invalid }) => (
                <Input
                  id={controlId}
                  name="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  value={secondFactor}
                  onChange={(event) =>
                    setSecondFactor(event.target.value.replace(/\D+/g, '').slice(0, 6))
                  }
                  className={controlVariants({ controlSize: 'public' })}
                />
              )}
            </Field>
          ) : (
            <Field
              id={`${formId}-recovery`}
              label={t('mfaRecoveryLabel')}
              hint={t('mfaRecoveryHint')}
              error={mfaFieldError}
            >
              {({ controlId, describedBy, invalid }) => (
                <Input
                  id={controlId}
                  name="mfa-recovery"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  value={secondFactor}
                  onChange={(event) => setSecondFactor(event.target.value.slice(0, 32))}
                  className={controlVariants({ controlSize: 'public' })}
                />
              )}
            </Field>
          )}

          <div className="flex flex-wrap items-center gap-6">
            <Button type="submit" size="lg" disabled={verify.isPending}>
              {verify.isPending ? t('mfaVerifying') : t('mfaVerify')}
            </Button>
            <button
              type="button"
              onClick={restartSignIn}
              className="text-meta font-medium text-secondary underline-offset-2 hover:underline"
            >
              {t('mfaCancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <Field
            id={`${formId}-org`}
            label={t('organizationIdLabel')}
            hint={t('organizationIdHint')}
            error={fieldError?.field === 'organizationId' ? fieldError.message : undefined}
          >
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                name="organizationId"
                autoComplete="organization"
                spellCheck={false}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                className={controlVariants({ controlSize: 'public' })}
              />
            )}
          </Field>

          <Field
            id={`${formId}-email`}
            label={t('emailLabel')}
            error={fieldError?.field === 'email' ? fieldError.message : undefined}
          >
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={controlVariants({ controlSize: 'public' })}
              />
            )}
          </Field>

          <Field
            id={`${formId}-password`}
            label={t('passwordLabel')}
            error={fieldError?.field === 'password' ? fieldError.message : undefined}
          >
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                name="password"
                type="password"
                autoComplete="current-password"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={controlVariants({ controlSize: 'public' })}
              />
            )}
          </Field>

          <div>
            <Button type="submit" size="lg" disabled={submit.isPending}>
              {submit.isPending ? t('signingIn') : t('submit')}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

/** Maps an error code to a sentence a staff member can act on. */
function errorCodeMessage(error: QueryError, t: (key: string) => string): string {
  switch (error.code) {
    case 'UNAUTHORIZED':
      return t('errors.unauthorized');
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

/** Second-factor phase: a 401 means the challenge or code was refused, not that
 * the credentials were wrong a second time. */
function verifyErrorCodeMessage(error: QueryError, t: (key: string) => string): string {
  if (error.code === 'UNAUTHORIZED') return t('errors.mfa');
  return errorCodeMessage(error, t);
}
