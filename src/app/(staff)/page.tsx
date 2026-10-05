import Link from 'next/link';

/**
 * Staff overview.
 *
 * The root path. Phase F1 delivers the shell and the first screen; the remaining
 * signature components wait on their own review, and no feature workspace is
 * started until the triage queue shape is signed off.
 */
export default function StaffOverviewPage() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header>
        <h1 className="text-heading font-semibold text-primary">Overview</h1>
        <p className="text-meta text-secondary">
          Staff workspace. Phase F1 — shell, navigation and the first screen.
        </p>
      </header>

      <section aria-labelledby="next-heading" className="max-w-prose">
        <h2 id="next-heading" className="mb-2 text-heading-xs font-semibold text-primary">
          What to review
        </h2>
        <ul className="list-inside list-disc space-y-1 text-body text-secondary">
          <li>
            <Link className="text-brand-ink underline underline-offset-2" href="/triage">
              Triage queue
            </Link>{' '}
            — column order, density, status treatment
          </li>
          <li>
            <Link className="text-brand-ink underline underline-offset-2" href="/design-system">
              Design system
            </Link>{' '}
            — tokens, type scale, primitives, both themes and densities
          </li>
        </ul>
      </section>
    </div>
  );
}
