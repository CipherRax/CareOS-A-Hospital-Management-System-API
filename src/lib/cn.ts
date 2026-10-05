import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The single class-name joiner for the whole app. `clsx` handles conditionals,
 * `tailwind-merge` resolves conflicting Tailwind utilities so a component's
 * default can be overridden by a caller's `className` without `!important`.
 *
 * Import this rather than assembling class strings by hand — an unmerged
 * `p-2 p-4` depends on stylesheet order, which Tailwind does not guarantee.
 */

/**
 * `text-*` is overloaded in Tailwind: it sets both font size and colour. Which one
 * you meant is resolved from the theme at build time, but tailwind-merge resolves
 * it from a hardcoded class list and cannot see our `@theme`, so it treats every
 * unknown `text-*` as the same thing and keeps only the last one.
 *
 * That is not a theoretical problem. `<Button variant="primary" size="sm">`
 * emits `text-on-fill` (a colour) and `text-meta` (a font size); merge deleted the
 * colour class outright, so every filled button silently inherited the body text
 * colour and dropped to 2.6:1 against the brand fill. The classes were in the
 * source and absent from the DOM.
 *
 * So the two groups are declared explicitly here. Anything added to the type scale
 * or to the palette must be added to the matching list, or it will be silently
 * dropped from class strings the next time two of them meet.
 */

/** Font sizes from src/app/tokens.scale.css (`--text-*`). */
const FONT_SIZES = [
  'meta',
  'caption',
  'body',
  'input',
  'heading-xs',
  'heading-sm',
  'heading',
  'heading-lg',
  'public-body',
  'public-caption',
  'public-small',
  'public-heading',
  'public-display',
] as const;

/** Colours from the generated palette (`--color-*` tokens). */
const TEXT_COLOURS = [
  // ink
  'primary',
  'secondary',
  'tertiary',
  'on-fill',
  'disabled',
  'brand-ink',
  // rails
  'rail',
  'rail-on',
  'rail-on-muted',
  // status
  'status-critical',
  'status-info',
  'status-success',
  'status-warning',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
      'text-color': [{ text: [...TEXT_COLOURS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
