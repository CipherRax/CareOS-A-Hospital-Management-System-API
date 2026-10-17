'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { PortalShell } from '@/components/portal/portal-shell';
import { useSession } from '@/lib/data/queries';

/**
 * Patient portal gate.
 *
 * Fails closed, like `StaffGate`: `children` renders only once `/auth/me` has
 * confirmed a session *and* that session is a patient principal. An unreachable
 * API counts as signed out, never as a pass.
 *
 * What is different from `StaffGate` is the third state. A staff member is
 * authenticated but is not a patient, and the right answer is not "signed out" —
 * it is a screen that says so and hands them a way back to the staff surface. The
 * two gates are therefore mirror images: `StaffGate` admits staff (and will not
 * admit a patient), `PortalGate` admits patients (and will not admit staff). A
 * principal that satisfies neither — the role without a linked record — is told
 * it has no patient record rather than being let in.
 *
 * The patient/not-patient decision is read from `SessionUser.isPatient`, derived
 * once in `normaliseSessionUser` so the two gates cannot disagree about what a
 * patient is.
 *
 * Every full-page state is a `<main>` landmark. A gate screen that replaces the
 * whole document must still be a document a screen reader can navigate — axe
 * fails a page with no main landmark, and rightly so.
 */
export function PortalGate({ children }: { children: React.ReactNode }) {
  const session = useSession();

  if (session.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-6">
        <p role="status" className="text-body text-secondary">
          Checking your session…
        </p>
      </main>
    );
  }

  if (session.isError || !session.data) {
    return <PortalSignedOut code={session.error?.code} />;
  }

  if (!session.data.data.isPatient) {
    return <NotAPatient />;
  }

  return <PortalShell user={session.data.data}>{children}</PortalShell>;
}

/**
 * Signed-out / unavailable page.
 *
 * The same two states `StaffGate` distinguishes, for the same reason: an expired
 * session earns a sign-in link, an unreachable API does not. Telling someone to
 * sign in when the network is down wastes a support call.
 */
function PortalSignedOut({ code }: { code: string | undefined }) {
  const t = useTranslations('error');
  const auth = useTranslations('auth');
  const unavailable = code === 'NETWORK_ERROR' || code === 'SERVICE_UNAVAILABLE';
  const key = unavailable ? 'unavailable' : 'unauthenticated';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h1 className="text-heading-sm font-semibold text-primary">{t(`${key}.title`)}</h1>
        <p className="mt-2 text-body text-secondary">{t(`${key}.body`)}</p>
        {unavailable ? null : (
          <Link
            href="/login"
            className="mt-4 inline-block rounded-md border border-border bg-surface px-4 py-2 text-body font-medium text-primary hover:bg-canvas"
          >
            {auth('signInNow')}
          </Link>
        )}
      </div>
    </main>
  );
}

/**
 * Authenticated, but not a patient.
 *
 * Covers both a staff login and a patient login that has not been provisioned
 * against a record yet. Both are told the portal is not for them and given the
 * one useful way forward — the staff workspace — rather than an empty page.
 */
function NotAPatient() {
  const t = useTranslations('portal');

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h1 className="text-heading-sm font-semibold text-primary">{t('title')}</h1>
        <p className="mt-2 text-body text-secondary">{t('notPatient.body')}</p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md border border-border bg-surface px-4 py-2 text-body font-medium text-primary hover:bg-canvas"
        >
          {t('notPatient.staffLink')}
        </Link>
      </div>
    </main>
  );
}
