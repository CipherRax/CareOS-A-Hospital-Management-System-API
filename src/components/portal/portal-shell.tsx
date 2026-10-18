'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { cn } from '@/lib/cn';
import type { SessionUser } from '@/lib/data/queries';

/**
 * Patient portal shell.
 *
 * Layout only, and deliberately unlike the staff shell: no clinical rail, no
 * badge counts, one column wide enough to read on a phone. A patient is not a
 * clinician at a workstation, and a screen that looks like the staff surface
 * invites them to assume it carries the same information.
 *
 * Takes `user` as a prop and never fetches its own identity: this renders behind
 * `PortalGate`, which has already confirmed the caller is a patient principal.
 * Fetching here would put the check and the thing being checked in one component.
 *
 * The nav landmark is named from i18n (`portal.navLabel`) rather than a fixed
 * string, because it is a *different* landmark from the staff rail's "Clinical"
 * nav — two navs on one page must not share an accessible name.
 */

const NAV = [
  { href: '/portal', key: 'profile' },
  { href: '/portal/appointments', key: 'appointments' },
  { href: '/portal/lab-results', key: 'labResults' },
  { href: '/portal/feedback', key: 'feedback' },
] as const;

export function PortalShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const t = useTranslations('portal');
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {/* Banner landmark: whose session this is, and how to end it. Shared
          workstation or shared phone, a patient must be able to tell. */}
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-2">
        <p className="text-body font-medium text-primary">careOS</p>
        <div className="flex items-center gap-3">
          <p className="text-meta text-secondary">
            {user.displayName || t('unknownName')}
          </p>
          <SignOutButton />
        </div>
      </header>

      <nav
        aria-label={t('navLabel')}
        className="flex shrink-0 gap-1 border-b border-border bg-surface px-6"
      >
        {NAV.map((item) => {
          // Exact match: `/portal` is a leaf route, so a prefix test would leave
          // the profile tab lit while the patient is on `/portal/appointments`.
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center border-b-2 px-3 text-body transition-colors',
                active
                  ? 'border-b-brand font-medium text-primary'
                  : 'border-transparent text-secondary hover:text-primary',
              )}
            >
              {t(`nav.${item.key}`)}
            </Link>
          );
        })}
      </nav>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
