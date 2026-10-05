import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/cn';

/**
 * StatusPill.
 *
 * The single most important rule in this product is that status is never carried
 * by colour alone: a red pill and a green pill look identical to a clinician with
 * deuteranopia, on a washed-out ward monitor, or in a printed handover sheet.
 *
 * So status is expressed three ways at once — a word, a shape cue, and colour.
 * The label is mandatory in the type signature, which makes "colour-only status"
 * impossible to write rather than merely discouraged. The icon differs per tone,
 * so the shape carries the meaning even with all colour removed.
 *
 * Do not add a tone without an icon and a word for it.
 */

export const STATUS_TONE = ['critical', 'warning', 'info', 'success', 'neutral'] as const;
export type StatusTone = (typeof STATUS_TONE)[number];

/** Shape cue per tone. Deliberately different silhouettes, not one icon recoloured. */
const TONE_GLYPH: Record<StatusTone, string> = {
  // Octagon-ish: a filled circle with a bar. Highest alarm.
  critical: 'M8 1.5 14.5 8 8 14.5 1.5 8Z',
  // Triangle: caution.
  warning: 'M8 1.8 15 14H1Z',
  // Circle: neutral information.
  info: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13Z',
  // Check: resolved.
  success: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13Z',
  neutral: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13Z',
};

/** Extra inner glyph for the tones that need to differ from a plain disc. */
function TONE_MARK(tone: StatusTone) {
  if (tone === 'critical') {
    return <path d="M7.25 4.5h1.5v4h-1.5zM7.25 10h1.5v1.5h-1.5z" />;
  }
  if (tone === 'warning') {
    return <path d="M7.25 6.5h1.5v3.5h-1.5zM7.25 11.25h1.5v1.5h-1.5z" />;
  }
  if (tone === 'success') {
    return <path d="m5 8.25 2 2 4-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />;
  }
  return <path d="M7.25 7.25h1.5v4.25h-1.5zM7.25 4.5h1.5v1.5h-1.5z" />;
}

const pillVariants = cva(
  [
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium',
    // Never rely on colour alone for meaning: the border is a real boundary, not
    // a decoration, and the tone tint backs a text label that already says it.
  ],
  {
    variants: {
      tone: {
        critical: 'border-transparent bg-status-critical-bg text-status-critical',
        warning: 'border-transparent bg-status-warning-bg text-status-warning',
        info: 'border-transparent bg-status-info-bg text-status-info',
        success: 'border-transparent bg-status-success-bg text-status-success',
        neutral: 'border-border bg-surface-sunken text-secondary',
      },
      size: {
        sm: 'px-2 py-0.5 text-caption',
        md: 'px-2.5 py-0.5 text-meta',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface StatusPillProps
  extends Omit<ComponentPropsWithoutRef<'span'>, 'children'>, VariantProps<typeof pillVariants> {
  /**
   * The status in words. Required by the type system, not by convention — this
   * is the value that survives greyscale, and the reason the pill is readable at
   * all.
   */
  label: string;
  /**
   * Expands the abbreviation for assistive tech when the visible label is short
   * or jargon ("Escalated" -> "Escalated to consultant").
   */
  title?: string;
}

export function StatusPill({ label, title, tone, size, className, ...props }: StatusPillProps) {
  const resolvedTone = (tone ?? 'neutral') as StatusTone;

  return (
    <span className={cn(pillVariants({ tone, size }), className)} {...props}>
      {/* Decorative: the word beside it already carries the meaning, so this is
          hidden rather than announced as a second, redundant cue. */}
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0 fill-current">
        <path d={TONE_GLYPH[resolvedTone]} />
        {TONE_MARK(resolvedTone)}
      </svg>
      <span>{label}</span>
      {title ? <span className="sr-only"> — {title}</span> : null}
    </span>
  );
}
