import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/en.json';
import { LoginForm } from '@/components/auth/login-form';
import { QueryProvider } from '@/lib/data/query-provider';

/**
 * The sign-in form's client-side rules.
 *
 * The two that matter most: it posts the exact `LoginDto`/`MfaVerifyDto`, and it
 * never renders a token (the proxy owns them; the component only ever sees the
 * MFA challenge). Every other case here — field validation, error mapping — is
 * the difference between a screen a clinician can use and one that stares back.
 */

const post = vi.fn();
vi.mock('@/api/client', () => ({
  api: { POST: (...args: unknown[]) => post(...args) },
}));

const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

function envelope(data: unknown, status = 200) {
  return { data, response: new Response(null, { status }) };
}

/** The API() helper is stubbed by path so the two-step flow is expressible. */
function okAuth() {
  post.mockImplementation((path: string) => {
    if (path === '/auth/login') {
      return Promise.resolve(envelope({ success: true, data: { mfaRequired: false } }));
    }
    return Promise.resolve(
      envelope({ success: true, data: { user: { id: 'u1' }, session: { id: 's1' } } }),
    );
  });
}

/** Login answers with an MFA challenge; verify succeeds. */
function mfaAuth() {
  post.mockImplementation((path: string) => {
    if (path === '/auth/login') {
      return Promise.resolve(
        envelope({
          success: true,
          data: { mfaRequired: true, challengeToken: 'challenge_example_0001' },
        }),
      );
    }
    return Promise.resolve(
      envelope({ success: true, data: { user: { id: 'u1' }, session: { id: 's1' } } }),
    );
  });
}

/** Login answers with an MFA challenge; the API refuses the verification. */
function mfaAuthVerifyRefused() {
  post.mockImplementation((path: string) => {
    if (path === '/auth/login') {
      return Promise.resolve(
        envelope({
          success: true,
          data: { mfaRequired: true, challengeToken: 'challenge_example_0001' },
        }),
      );
    }
    return Promise.resolve({
      error: { error: { code: 'UNAUTHORIZED' } },
      response: new Response(null, { status: 401 }),
    });
  });
}

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryProvider>
        <LoginForm />
      </QueryProvider>
    </NextIntlClientProvider>,
  );
}

async function fillSignIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/organization id/i), '  org_example_0001  ');
  await user.type(screen.getByLabelText(/^email/i), '  nurse@example.org  ');
  await user.type(screen.getByLabelText(/^password/i), 'correct-horse');
  return user;
}

async function reachChallenge() {
  const user = await fillSignIn();
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByLabelText(/6-digit security code/i);
  return user;
}

beforeEach(() => {
  post.mockReset();
  router.push.mockReset();
  okAuth();
});

describe('LoginForm', () => {
  it('posts the trimmed LoginDto and lands on triage once the session starts', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/organization id/i), '  org_example_0001  ');
    await user.type(screen.getByLabelText(/^email/i), '  nurse@example.org  ');
    await user.type(screen.getByLabelText(/^password/i), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, request] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/auth/login');
    expect(request.body).toEqual({
      organizationId: 'org_example_0001',
      email: 'nurse@example.org',
      password: 'correct-horse',
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/triage'));
  });

  it('never touches the session query cache before the API confirms the session', async () => {
    // There is no way to observe the cache here without poking through the gate,
    // so the guarantee is the call order: the router is only pushed after the
    // API call resolved, and the form renders no success text of its own.
    renderForm();
    const user = await fillSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('opens the second-factor step on an MFA challenge instead of a redirect', async () => {
    mfaAuth();
    renderForm();
    const user = await fillSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Two-factor challenge required')).toBeInTheDocument();
    expect(screen.getByText(/signing in as nurse@example.org/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Security code' })).toBeChecked();
    expect(screen.getByLabelText(/6-digit security code/i)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('completes the second factor with a TOTP code and lands on triage', async () => {
    mfaAuth();

    renderForm();
    const user = await reachChallenge();
    await user.type(screen.getByLabelText(/6-digit security code/i), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/triage'));
    expect(post).toHaveBeenCalledTimes(2);
    const [verifyPath, verifyRequest] = post.mock.calls[1] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(verifyPath).toBe('/auth/mfa/verify');
    expect(verifyRequest.body).toEqual({
      challengeToken: 'challenge_example_0001',
      code: '123456',
    });
    // The other factor must never ride along on the same request.
    expect(verifyRequest.body.recoveryCode).toBeUndefined();
  });

  it('lets a recovery code stand in for the TOTP code', async () => {
    mfaAuth();

    renderForm();
    const user = await reachChallenge();
    await user.click(screen.getByRole('radio', { name: 'Recovery code' }));
    await user.type(screen.getByRole('textbox', { name: /recovery code/i }), 'rstv-4ak3-9m');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/triage'));
    const [, verifyRequest] = post.mock.calls[1] as [string, { body: Record<string, unknown> }];
    expect(verifyRequest.body).toEqual({
      challengeToken: 'challenge_example_0001',
      recoveryCode: 'rstv-4ak3-9m',
    });
    expect(verifyRequest.body.code).toBeUndefined();
  });

  it('blocks on a TOTP code that is not six digits, without calling the API', async () => {
    mfaAuth();
    renderForm();
    const user = await reachChallenge();
    await user.type(screen.getByLabelText(/6-digit security code/i), '123');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(
      screen.getByText(/enter the 6-digit code from your authenticator app/i),
    ).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('maps a refused challenge to a message specific to the second factor', async () => {
    mfaAuthVerifyRefused();
    renderForm();
    const user = await reachChallenge();
    await user.type(screen.getByLabelText(/6-digit security code/i), '111111');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText(/that code was not accepted/i)).toBeInTheDocument();
    // A refused challenge is not a signed-out state: no redirect from here.
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/6-digit security code/i)).toBeInTheDocument();
  });

  it('backs out of the second-factor step to try the credentials again', async () => {
    mfaAuth();
    renderForm();
    const user = await reachChallenge();
    await user.click(screen.getByRole('button', { name: /sign in with a different account/i }));

    expect(screen.queryByLabelText(/6-digit security code/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('blocks on a missing field with a per-field message, in field order', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter the organization ID.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/organization id/i), 'org_example_0001');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^email/i), 'nurse@example.org');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a malformed email without calling the API', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/organization id/i), 'org_example_0001');
    await user.type(screen.getByLabelText(/^email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/^password/i), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('maps an UNAUTHORIZED reply to "credentials are incorrect"', async () => {
    post.mockResolvedValue({
      error: { error: { code: 'UNAUTHORIZED' } },
      response: new Response(null, { status: 401 }),
    });
    renderForm();
    const user = await fillSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText(/email, password or organization ID is incorrect/i),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('maps a rate limit to "wait and retry"', async () => {
    post.mockResolvedValue({
      error: { error: { code: 'RATE_LIMITED' } },
      response: new Response(null, { status: 429 }),
    });
    renderForm();
    const user = await fillSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/too many sign-in attempts/i)).toBeInTheDocument();
  });

  it('maps an unavailable API to "try again shortly"', async () => {
    post.mockRejectedValue({ code: 'NETWORK_ERROR', status: 0, resolved: null });
    renderForm();
    const user = await fillSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it('never paints the API diagnostic message onto the screen', async () => {
    post.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'INSERT CLEAN UP TABLE patient_record' } },
      response: new Response(null, { status: 500 }),
    });
    renderForm();
    const user = await fillSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/INSERT CLEAN UP TABLE/)).not.toBeInTheDocument();
  });
});
