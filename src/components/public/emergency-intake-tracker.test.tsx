import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/en.json';
import { EmergencyIntakeTracker } from '@/components/public/emergency-intake-tracker';
import { QueryProvider } from '@/lib/data/query-provider';

/**
 * The tracker's client-side rules.
 *
 * The two that matter most are asserted here rather than left to review: the
 * request body is keyed by `token` (the tracking secret, not the reference), and
 * every error path maps to a sentence a member of the public can act on — the
 * API's diagnostic `message` never reaches the screen.
 */

const post = vi.fn();
vi.mock('@/api/client', () => ({
  api: { POST: (...args: unknown[]) => post(...args) },
}));

function okTracking() {
  post.mockResolvedValue({
    data: {
      success: true,
      data: {
        referenceNumber: 'EX-EM-00001',
        status: 'RECEIVED',
        statusLabel: 'Received',
        message: 'We have notified the facility. Keep this token to check again as your request advances.',
        facility: { name: 'EXAMPLE General Hospital', phone: '+254 700 000 111' },
        numbers: [{ purpose: 'emergency', label: 'National emergency', phone: '+254 999', hours: '24/7' }],
        guidance: null,
        disclaimer: 'careOS does not dispatch emergency services or guarantee a response time.',
      },
    },
    response: new Response(null, { status: 200 }),
  });
}

function renderTracker() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryProvider>
        <EmergencyIntakeTracker />
      </QueryProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  post.mockReset();
  okTracking();
});

describe('EmergencyIntakeTracker', () => {
  it('tracks by token — the secret keyed body, never the reference', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'ex-tok-00001');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, request] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/public/emergency-requests/track');
    expect(request.body).toEqual({ token: 'ex-tok-00001' });
  });

  it('renders the API words: status label, message, reference and emergency numbers', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'ex-tok-00001');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    expect(await screen.findByText('EX-EM-00001')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(
      screen.getByText(/we have notified the facility\. keep this token/i),
    ).toBeInTheDocument();
    expect(screen.getByText('EXAMPLE General Hospital')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+254 700 000 111' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+254 999' })).toBeInTheDocument();
    expect(
      screen.getByText(/careOS does not dispatch emergency services/i),
    ).toBeInTheDocument();
  });

  it('tells the caller to keep the token, without claiming help is coming', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'ex-tok-00001');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    await screen.findByText('EX-EM-00001');
    // The API said RECEIVED; nothing on this screen may outrun that claim.
    expect(screen.getByText(/keep your token/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/ambulance|on its way|a clinician|will be seen|queue position/i),
    ).not.toBeInTheDocument();
  });

  it('maps an unknown token to a readable message, not the API diagnostic', async () => {
    post.mockResolvedValue({
      data: undefined,
      error: {
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'No request found for that tracking token.' },
      },
      response: new Response(null, { status: 404 }),
    });

    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'ex-tok-00001');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    expect(await screen.findByText(/no request found for that token/i)).toBeInTheDocument();
    expect(screen.queryByText(/No request found for that tracking token/i)).not.toBeInTheDocument();
  });

  it('maps a rate limit to something a member of the public can act on', async () => {
    post.mockResolvedValue({
      data: undefined,
      error: { success: false, error: { code: 'RATE_LIMITED', message: 'diag' } },
      response: new Response(null, { status: 429 }),
    });

    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'ex-tok-00001');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    expect(await screen.findByText(/too many searches\. wait a moment/i)).toBeInTheDocument();
    expect(screen.queryByText('diag')).not.toBeInTheDocument();
  });

  it('refuses a short or empty token before spending a rate-limited attempt', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'short');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    expect(await screen.findByText(/enter the full tracking token/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not render a body that is not a tracking result', async () => {
    post.mockResolvedValue({
      data: { success: true, data: { vaguely: 'a result' } },
      response: new Response(null, { status: 200 }),
    });

    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'ex-tok-00001');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    expect(await screen.findByText(/could not be checked\. try again/i)).toBeInTheDocument();
    expect(screen.queryByText('a result')).not.toBeInTheDocument();
  });

  it('returns to the form, clearing the token, after a check', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.type(screen.getByLabelText(/tracking token/i), 'ex-tok-00001');
    await user.click(screen.getByRole('button', { name: /track request/i }));

    await screen.findByText('EX-EM-00001');
    await user.click(screen.getByRole('button', { name: /check another token/i }));

    // The token was a secret on a possibly shared machine; it must not linger.
    expect(screen.getByLabelText(/tracking token/i)).toBeVisible();
    expect(screen.getByLabelText<HTMLInputElement>(/tracking token/i)).toHaveValue('');
  });
});