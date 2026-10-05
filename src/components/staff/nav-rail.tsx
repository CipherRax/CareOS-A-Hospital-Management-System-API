'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

/**
 * Staff navigation rail.
 *
 * Clinical Editorial, not a consumer sidebar: a fixed full-height column of
 * border-separated rows, text-first labels, and no icons in the resting state.
 * Icons are decoration here — every destination is named in words, because a
 * rail that relies on pictograms is unreadable to a clinician who has never used
 * this software and does not want to learn its iconography under time pressure.
 *
 * The active row is marked by weight, an ink colour, a left rule and a tinted
 * background — four signals, so the current location survives greyscale
 * printing, sunlight, and colour vision deficiency. An accent bar alone would
 * fail WCAG 1.4.11 against the surface behind it.
 *
 * `aria-current="page"` is the authoritative signal; the styling mirrors it
 * rather than substituting for it.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /**
   * Count shown as a badge. Rendered as text with an accessible name, never as a
   * bare number — "3" beside an icon tells a screen reader nothing.
   */
  readonly count?: number;
  readonly countLabel?: string;
}

export interface NavSection {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export function NavRail({
  sections,
  className,
}: {
  sections: readonly NavSection[];
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Clinical"
      className={cn('flex w-60 shrink-0 flex-col border-r border-border bg-surface', className)}
    >
      {sections.map((section, index) => (
        <div
          key={section.id}
          className={cn(
            'flex flex-col py-3',
            // Border between sections, not padding-as-separation.
            index > 0 && 'border-t border-border',
          )}
        >
          <p className="px-4 pb-1 font-mono text-caption uppercase tracking-wide text-tertiary">
            {section.label}
          </p>
          <ul className="flex flex-col">
            {section.items.map((item) => {
              // Exact match for the index, prefix match for a section's children,
              // so a nested route does not light up its parent's sibling.
              const active =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(`${item.href}/`));

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    // Composed explicitly rather than left to text concatenation:
                    // the visible label and the badge are separate elements, and a
                    // screen reader otherwise announces "Triage queue3 awaiting
                    // review" with the words run together. The name still contains
                    // every visible string, so voice control keeps working.
                    aria-label={
                      typeof item.count === 'number'
                        ? `${item.label}, ${item.count} ${item.countLabel ?? 'items'}`
                        : undefined
                    }
                    className={cn(
                      'relative flex min-h-11 items-center justify-between gap-2 py-2 pl-4 pr-3',
                      'text-body transition-colors',
                      'border-l-2 border-transparent',
                      active
                        ? 'border-l-brand bg-surface-selected font-medium text-primary'
                        : 'text-secondary hover:bg-surface-hover hover:text-primary',
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {typeof item.count === 'number' ? (
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-px font-mono text-caption tabular-nums',
                          active
                            ? 'bg-brand-subtle text-brand-ink'
                            : 'bg-surface-sunken text-secondary',
                        )}
                      >
                        {/* The numeral is hidden from assistive tech and the label
                            is supplied in text, so this announces "3 awaiting
                            review" rather than a bare "3". */}
                        {/* The count is conveyed by the link's aria-label above;
                            hidden here so it is not announced twice. */}
                        <span aria-hidden="true">{item.count}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
