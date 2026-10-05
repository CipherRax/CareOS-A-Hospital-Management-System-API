'use client';

import { NavRail, type NavSection } from '@/components/staff/nav-rail';
import { useSession } from '@/lib/data/queries';

/**
 * Staff shell.
 *
 * Layout only. The rail is a landmark and the scrolling region is a `main`, so a
 * screen reader can jump between them; that is why the two are separate elements
 * rather than one flex row of divs.
 *
 * `NavItem.count` is supported but deliberately unused here. The endpoint that
 * would feed it (`GET /triage/counts`) is not in the contract, and inventing one
 * to fill a gap in a navigation bar is exactly the wrong trade — a hard-coded
 * number that looks live is more dangerous than no number. See GAP-009.
 */

const SECTIONS: readonly NavSection[] = [
  {
    id: 'clinical',
    label: 'Clinical',
    items: [
      { href: '/', label: 'Overview' },
      { href: '/triage', label: 'Triage queue' },
      { href: '/patients', label: 'Patients' },
    ],
  },
  {
    id: 'ward',
    label: 'Ward',
    items: [
      { href: '/display', label: 'Display board' },
      { href: '/handover', label: 'Handover' },
      { href: '/reports', label: 'Reports' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { href: '/settings', label: 'Settings' },
      { href: '/design-system', label: 'Design system' },
    ],
  },
];

export function StaffShell({ children }: { children: React.ReactNode }) {
  const session = useSession();

  return (
    <div className="flex min-h-dvh bg-canvas">
      <NavRail sections={SECTIONS} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Banner landmark: who is signed in, and how to sign out. Omitting it
            leaves staff unable to tell whose session a screen belongs to, which
            matters when a workstation is shared. */}
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6">
          <p className="text-body font-medium text-primary">careOS</p>
          <div className="flex items-center gap-3">
            {session.data ? (
              <p className="text-meta text-secondary">
                {session.data.data.displayName}
                <span className="text-tertiary"> · {session.data.data.roleLabel}</span>
              </p>
            ) : null}
            <a
              href="/auth/logout"
              className="rounded-md px-2 py-1 text-meta text-secondary underline-offset-2 hover:bg-surface-hover hover:text-primary hover:underline"
            >
              Sign out
            </a>
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
