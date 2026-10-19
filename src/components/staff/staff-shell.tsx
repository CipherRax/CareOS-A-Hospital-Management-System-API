'use client';

import { useTranslations } from 'next-intl';

import { NavRail, type NavSection } from '@/components/staff/nav-rail';
import { SignOutButton } from '@/components/auth/sign-out-button';
import type { SessionUser } from '@/lib/data/queries';

/**
 * Staff shell.
 *
 * Layout only. The rail is a landmark and the scrolling region is a `main`, so a
 * screen reader can jump between them; that is why the two are separate elements
 * rather than one flex row of divs.
 *
 * Takes `user` as a prop and never fetches it: this component renders staff
 * content, so it must not be reachable without `StaffGate` having already
 * confirmed a session. Fetching its own identity would mean the check and the
 * thing being checked live in the same component.
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
      { href: '/queue', label: 'Reception queue' },
      { href: '/appointments', label: 'Appointments' },
      { href: '/vitals', label: 'Vitals' },
      { href: '/encounters', label: 'Encounters' },
      { href: '/lab', label: 'Laboratory' },
      { href: '/radiology', label: 'Radiology' },
      { href: '/pharmacy', label: 'Pharmacy' },
      { href: '/patients', label: 'Patients' },
      { href: '/emergency', label: 'Emergency' },
    ],
  },
  {
    id: 'ward',
    label: 'Ward',
    items: [
      { href: '/wards', label: 'Ward board' },
      { href: '/admissions', label: 'Admissions' },
      { href: '/handover', label: 'Handover' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics' },
      { href: '/reports', label: 'Reports' },
    ],
  },
  {
    id: 'quality',
    label: 'Quality',
    items: [
      { href: '/quality/feedback', label: 'Feedback' },
      { href: '/quality/complaints', label: 'Complaints' },
      { href: '/quality/incidents', label: 'Incidents' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { href: '/billing', label: 'Billing' },
      { href: '/insurance', label: 'Insurance' },
      { href: '/insurance/payers', label: 'Insurance payers' },
      { href: '/users', label: 'Users' },
      { href: '/roles', label: 'Roles' },
      { href: '/staff', label: 'Staff' },
      { href: '/organization', label: 'Organization' },
      { href: '/schedules', label: 'Schedules' },
      { href: '/settings', label: 'Settings' },
      { href: '/design-system', label: 'Design system' },
    ],
  },
];

export function StaffShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const t = useTranslations('auth');

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
            <p className="text-meta text-secondary">
              {user.displayName || t('unknownName')}
              {user.roleLabel ? <span className="text-tertiary"> · {user.roleLabel}</span> : null}
            </p>
            <SignOutButton />
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
