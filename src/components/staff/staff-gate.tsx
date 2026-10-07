'use client';

import { useTranslations } from 'next-intl';

import { useSession } from '@/lib/data/queries';
import { StaffShell } from '@/components/staff/staff-shell';

/**
 * Staff session gate.
 *
 * Fails closed. Until this existed, every staff route rendered its full chrome to
 * any visitor, including an unauthenticated one. What sits behind it was fixtures,
 * so nothing sensitive leaked — but that is an accident of sequencing, not a
 * property of the design, and the failure to guard against is the next record
 * arriving before the gate does.
 *
 * The rule is deliberately unforgiving: `children` is not rendered unless a session
 * has been positively confirmed. An unreachable API counts as signed out, not as a
 * free pass. A clinician locked out by a network blip is an inconvenience; a
 * clinician looking at another clinician's session is an incident.
 *
 * The signed-out state is its own page rather than a redirect, because there is no
 * sign-in route to redirect to (GAP-010). Inventing `/auth/login` would only produce
 * a link that 404s, and a control that looks like it works while it does not is
 * worse than an honest dead end.
 *
 * `/auth/me` exists upstream (verified live: it returns 401 `UNAUTHORIZED` with no
 * session) but its success body is untyped in the exported document — the gate
 * depends only on a 2xx meaning "signed in", so it stays correct regardless.
 */
export function StaffGate({ children }: { children: React.ReactNode }) {
  const session = useSession();

  if (session.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
        {/* `role="status"` so a screen reader hears that the page is working
            instead of sitting on unexplained silence. */}
        <p role="status" className="text-body text-secondary">
          Checking your session…
        </p>
      </div>
    );
  }

  if (session.isError || !session.data) {
    return <SignedOut code={session.error?.code} />;
  }

  return <StaffShell user={session.data.data}>{children}</StaffShell>;
}

/**
 * Signed-out page.
 *
 * The message is chosen by error code rather than written inline, so an expired
 * session and an unreachable API read differently: one says sign in again, the
 * other says wait. Telling a clinician to sign in when the problem is the network
 * wastes a support call and teaches people to ignore the message.
 */
function SignedOut({ code }: { code: string | undefined }) {
  const t = useTranslations('error');
  const key =
    code === 'NETWORK_ERROR' || code === 'SERVICE_UNAVAILABLE' ? 'unavailable' : 'unauthenticated';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h1 className="text-heading-sm font-semibold text-primary">{t(`${key}.title`)}</h1>
        <p className="mt-2 text-body text-secondary">{t(`${key}.body`)}</p>
        {/* No link out. There is no sign-in route to link to, and a dead link on a
            dead end is a support call waiting to happen. */}
      </div>
    </div>
  );
}
