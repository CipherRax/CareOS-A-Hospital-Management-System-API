import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import messages from '@/i18n/messages/en.json';
import { StaffGate } from '@/components/staff/staff-gate';
import { resolveApiError } from '@/lib/errors/catalog';

/**
 * The gate's whole job is deciding whether to render staff content, so that
 * decision is tested directly rather than inferred from a browser run. A network
 * abort in an end-to-end test is a blunt instrument here: it proved unreliable to
 * apply, and a test that intermittently does not intercept proves nothing.
 */

const sessionState = {
  isPending: false,
  isError: false,
  data: undefined as unknown,
  error: undefined as unknown,
};

// `vi.mock` is hoisted above the const above, so the factory reads the state lazily
// rather than capturing it.
vi.mock('@/lib/data/queries', () => ({
  useSession: () => sessionState,
}));

// jsdom has no router, so usePathname resolves to null. StaffShell renders the rail,
// which needs a real pathname.
vi.mock('next/navigation', () => ({ usePathname: () => '/triage' }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function renderGate() {
  return render(
    // The signed-out page reads the error catalogue through next-intl, so the
    // provider is part of the contract under test.
    <NextIntlClientProvider locale="en" messages={messages}>
      <StaffGate>
        <p>Staff content</p>
      </StaffGate>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  sessionState.isPending = false;
  sessionState.isError = false;
  sessionState.data = undefined;
  sessionState.error = undefined;
});

describe('StaffGate', () => {
  it('renders staff content only once a session is confirmed', () => {
    sessionState.data = { data: { displayName: 'EXAMPLE Dr N. Wanjiru', roleLabel: 'Registrar' } };
    renderGate();
    expect(screen.getByText('Staff content')).toBeInTheDocument();
  });

  it('withholds staff content when the API says there is no session', () => {
    // The failure mode this exists to prevent: staff content reaching a visitor
    // who has not signed in.
    sessionState.isError = true;
    sessionState.error = {
      code: 'UNAUTHENTICATED',
      status: 401,
      resolved: resolveApiError('UNAUTHENTICATED'),
    };
    renderGate();
    expect(screen.queryByText('Staff content')).not.toBeInTheDocument();
  });

  it('withholds staff content when the API is unreachable', () => {
    // Fails closed. Treating an unreachable API as signed in is a free pass to
    // anyone the network happens to drop.
    sessionState.isError = true;
    sessionState.error = {
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      resolved: resolveApiError('SERVICE_UNAVAILABLE'),
    };
    renderGate();
    expect(screen.queryByText('Staff content')).not.toBeInTheDocument();
  });

  it('renders nothing but a status while the session is being checked', () => {
    sessionState.isPending = true;
    renderGate();
    expect(screen.queryByText('Staff content')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
  });

  it('distinguishes an expired session from a service outage', () => {
    // Telling a clinician to sign in when the service is down sends them to the
    // wrong place and teaches them to ignore the message.
    sessionState.isError = true;
    sessionState.error = { code: 'UNAUTHENTICATED', resolved: resolveApiError('UNAUTHENTICATED') };
    const { unmount } = renderGate();
    expect(screen.getByRole('heading', { name: 'Please sign in again' })).toBeInTheDocument();
    unmount();

    sessionState.error = {
      code: 'SERVICE_UNAVAILABLE',
      resolved: resolveApiError('SERVICE_UNAVAILABLE'),
    };
    renderGate();
    expect(
      screen.getByRole('heading', { name: 'Service temporarily unavailable' }),
    ).toBeInTheDocument();
  });

  it('offers no sign-out or sign-in link that would 404', () => {
    // Both routes are undefined (GAP-010). A link to a 404 teaches staff that the
    // control works when it does not.
    sessionState.isError = true;
    sessionState.error = { code: 'UNAUTHENTICATED', resolved: resolveApiError('UNAUTHENTICATED') };
    renderGate();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
