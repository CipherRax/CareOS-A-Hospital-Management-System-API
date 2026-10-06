import { LocaleSwitcher } from '@/components/public/locale-switcher';

/**
 * Public route group.
 *
 * Outside `(staff)` and unauthenticated, because everything here is reachable by
 * anyone with the URL. The public surface gets no nav rail, no session header and no
 * staff chrome — a person reporting an emergency does not need to be told who is
 * signed in, and a member of the public must not be able to wander into staff
 * screens by editing a URL.
 *
 * The group exists so a patient portal can grow here without a routing migration,
 * and so anything shared with the public surface (error handling, layout) is
 * visibly separate from staff concerns.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-4">
        <p className="text-public-heading font-semibold text-primary">careOS</p>
        {/* Present only here. On the staff surface the language follows the managed
            workstation, and an accidental switch mid-consultation costs more than it
            gives. */}
        <LocaleSwitcher />
      </header>
      {/* `main` declared here rather than inherited from a shell, for the same reason
          as the display group: a landmark inherited from an ancestor disappears the
          moment that ancestor changes. */}
      <main className="mx-auto w-full max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
