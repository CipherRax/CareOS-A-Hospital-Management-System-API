import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * Empty state.
 *
 * The brief asks for "a useful next action, no illustrations", and the second half
 * is the harder constraint. An empty state is the one place a product is most
 * tempted to fill space — an illustration, an illustration inside a tinted card,
 * three lines of marketing copy. None of that tells a nurse what to do next.
 *
 * So: an optional single Lucide icon at the interface's stroke weight, a title that
 * says what is missing, an optional sentence of context, and an action. If there is
 * genuinely nothing to offer, `action` is omitted rather than filled with a
 * disabled button.
 *
 * Empty is a real state, not an error. It is not styled as one, and it does not
 * announce itself through a live region — nothing changed, so nothing is asserting
 * that something did.
 */

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  /** 2 when the empty state is the page's main subject, 3 when it sits inside one. */
  headingLevel?: 2 | 3;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 border border-border bg-surface px-6 py-8',
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden className="size-5 shrink-0 text-tertiary" strokeWidth={1.5} />
      ) : null}

      <div className="flex flex-col gap-1">
        <Heading className="text-body font-semibold text-primary">{title}</Heading>
        {description ? <p className="max-w-prose text-meta text-secondary">{description}</p> : null}
      </div>

      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
