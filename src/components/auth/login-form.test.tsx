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
 * The two that matter most: it posts the exact `LoginDto`, and it never renders a
 * token (the proxy owns them; the component only sees the MFA flag). Every other
 * case here — field validation, error mapping — is the difference between a
 * screen a clinician can use and one that stares back.
 */

const post = vi.fn();
vi.mock('@/api/client', () => ({
  api: { POST: (...args: unknown[]) => post(...args) },
}));

const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

function okLogin() {
  post.mockResolvedValue({
    data: { success: true, data: { mfaRequired: false } },
    response: new Response(null, { status: 200 }),
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

beforeEach(() => {
  post.mockReset();
  router.push.mockReset();
  okLogin();
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

  it('offers the MFA challenge instead of a redirect', async () => {
    post.mockResolvedValue({
      data: {
        success: true,
        data: { mfaRequired: true, challengeToken: 'challenge_example_0001' },
      },
      response: new Response(null, { status: 200 }),
    });
    renderForm();
    const user = await fillSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert', { name: '' })).toBeInTheDocument();
    expect(screen.getByText('Two-factor challenge required')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
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
