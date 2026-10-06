'use client';

import * as Popover from '@radix-ui/react-popover';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/cn';

/**
 * Estimate marker.
 *
 * The brief requires this on **every** predicted, inferred or forecast number, and
 * the requirement is the point: a wait time that was modelled looks exactly like a
 * wait time that was measured, and a clinician who cannot tell which one they are
 * looking at will act on it as if it were measured.
 *
 * So the type signature requires provenance. `method` and `dataPeriod` are not
 * optional, which means this component cannot be rendered without saying where the
 * number came from and what it was computed over. Making them optional would have
 * been easier and would have produced badges that say "Estimate" and nothing else —
 * the exact failure the brief is guarding against.
 *
 * Deliberately not a colour: the marker is a word and an icon, and it stays legible
 * in greyscale and on a monochrome ward printer. Where an estimate appears inside a
 * chart, the brief's rule applies at the series level too — dashed line and a
 * "Forecast" label, not a lighter shade.
 */

export interface EstimateBadgeProps {
  /** How the number was produced. Shown to the reader, not just stored. */
  method: string;
  /** The period the estimate was computed over. */
  dataPeriod: string;
  /** Model and version, where the API supplies them. */
  model?: string;
  version?: string;
  /** Range or confidence, where supplied. */
  uncertainty?: string;
  /** Overrides the default "Estimate" word. */
  label?: string;
  className?: string;
}

export function EstimateBadge({
  method,
  dataPeriod,
  model,
  version,
  uncertainty,
  label,
  className,
}: EstimateBadgeProps) {
  const t = useTranslations('estimate');

  const rows: [string, string | undefined][] = [
    [t('method'), method],
    [t('dataPeriod'), dataPeriod],
    [t('model'), model && version ? `${model} ${version}` : model],
    [t('uncertainty'), uncertainty],
  ];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-caption font-medium uppercase tracking-wide text-secondary hover:bg-surface-hover hover:text-primary',
            className,
          )}
        >
          <Info aria-hidden className="size-3.5" strokeWidth={1.5} />
          {label ?? t('label')}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          // 6px is the panel radius from the token scale. `sideOffset` keeps the
          // trigger's own focus ring visible, which a flush popover covers.
          sideOffset={6}
          align="start"
          className={cn(
            'z-50 max-w-xs rounded-lg border border-border-strong bg-surface-raised p-3 shadow-overlay',
          )}
        >
          <dl className="flex flex-col gap-2">
            {rows
              .filter((row): row is [string, string] => Boolean(row[1]))
              .map(([term, detail]) => (
                <div key={term} className="flex flex-col gap-0.5">
                  <dt className="text-caption uppercase tracking-wide text-tertiary">{term}</dt>
                  <dd className="text-meta text-primary">{detail}</dd>
                </div>
              ))}
          </dl>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
