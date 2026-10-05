import Link from 'next/link';

/**
 * Root placeholder.
 *
 * Phase F0 delivers foundations only — no feature workspace exists yet, per the
 * brief's phase plan. This page exists so the app has a valid entry point and so
 * the design system is discoverable during review.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-heading-lg font-semibold text-primary">careOS</h1>
      <p className="text-body text-secondary">
        Hospital management platform. Phase F0 — design system and foundations — is complete;
        feature workspaces begin after design review.
      </p>
      <ul className="list-inside list-disc text-body text-secondary">
        <li>
          <Link className="text-brand-ink underline underline-offset-2" href="/design-system">
            Design system
          </Link>{' '}
          — tokens, type scale, primitives, both themes and densities
        </li>
      </ul>
    </main>
  );
}
