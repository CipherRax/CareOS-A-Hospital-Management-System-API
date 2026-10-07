import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import messages from '@/i18n/messages/en.json';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { QueryProvider } from '@/lib/data/query-provider';
import { server } from '@/mocks/server';

/**
 * Sign-out is a handshake with the proxy: the browser cannot know the refresh
 * token, so it only asks, and the proxy is the one that clears the cookies. The
 * button's contract is "on a 2xx, drop the session cache and refresh the page" —
 * and, crucially, "on anything else, leave the session alone and say so".
 *
 * Requests ride the same MSW server the rest of the suite uses, so the default
 * `/auth/logout` handler stands in for the proxy's 204, and `server.use` overrides
 * it for the failure case.
 */

const router = { refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryProvider>
        <SignOutButton />
      </QueryProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  router.refresh.mockReset();
});

describe('SignOutButton', () => {
  it('asks the proxy to end the session and refreshes on a 204', async () => {
    const requests: Request[] = [];
    server.use(
      http.post('*/api/v1/auth/logout', ({ request }) => {
        requests.push(request);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const request = requests[0]!;
    expect(request.url).toContain('/api/v1/auth/logout');
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('{}');
    // The refresh token never leaves the client — the proxy injects it.
    expect(request.headers.get('authorization')).toBeNull();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('refreshes the route only after the proxy answered, so the gate flips signed-out', async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('treats an upstream failure as a failed sign-out, not a silent success', async () => {
    server.use(http.post('*/api/v1/auth/logout', () => new HttpResponse(null, { status: 502 })));

    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Sign out failed' })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
