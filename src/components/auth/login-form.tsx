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
 * Posting the exact `LoginDto` the live API declares. The token pair never
 * reaches this component: the same-origin proxy lifts it out of the response and
 * into two HttpOnly cookies (see `src/app/api/v1/[...path]/route.ts`), then the
 * next `/auth/me` completes through the session cookie. The screen only ever
 * sees the MFA flag — either the session is started, or the API said something
 * and this form says it back in a sentence a person can act on.
 *
 * Errors are mapped by code. The API's diagnostic `message` is never rendered.
 */
type LoginDto = components['schemas']['LoginDto'];

interface LoginPayload {
  mfaRequired: boolean;
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
  const [mfaRequired, setMfaRequired] = useState(false);

  const submit = useMutation({
    mutationFn: async (): Promise<LoginPayload & { sessionStarted: boolean }> => {
      const result = await api.POST('/auth/login', {
        body: {
          organizationId: organizationId.trim(),
          email: email.trim(),
          password,
        } satisfies LoginDto,
      });
      // The proxy sanitised the response, but trust is still earned: the
      // challenge flag is only believed when it is a boolean.
      const envelope = await unwrapForTest<unknown>(result);
      const data =
        envelope.data && typeof envelope.data === 'object'
          ? (envelope.data as { mfaRequired?: unknown; user?: unknown })
          : {};
      const mfa = data.mfaRequired === true;
      return { mfaRequired: mfa, sessionStarted: !mfa };
    },
    onSuccess: async (payload) => {
      if (payload.sessionStarted) {
        // The session cookie is live; drop the query's cached signed-out state
        // before landing the gate on the staff surface.
        await queryClient.invalidateQueries({ queryKey: ['session'] });
        router.push('/triage');
      } else {
        setMfaRequired(true);
      }
    },
  });

  const error = submit.error as unknown as QueryError | undefined;

  return (
    <form
      noValidate
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
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
        setMfaRequired(false);
        submit.mutate();
      }}
      className="flex max-w-xl flex-col gap-6"
    >
      <h1 id={`${formId}-title`} className="text-public-heading font-semibold text-primary">
        {t('signInTitle')}
      </h1>
      <p className="text-public-body text-secondary">{t('signInIntro')}</p>

      {mfaRequired ? (
        <div role="alert" className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-public-body font-medium text-primary">{t('mfaChallengeTitle')}</p>
          <p className="mt-1 text-public-body text-secondary">{t('mfaChallengeBody')}</p>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-lg border border-status-critical bg-surface px-4 py-3">
          <p className="text-public-heading font-semibold text-status-critical">
            {t('errorHeading')}
          </p>
          <p className="mt-1 text-public-body text-status-critical">{errorCodeMessage(error, t)}</p>
        </div>
      ) : null}

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
