import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * Button.
 *
 * Every fill/label pair here is asserted in `CONTRAST_CHECKS`, including hover
 * and active, which is why `text-on-fill` is a theme-aware token rather than a
 * literal `text-white`. In dark theme the brand is a light teal and a white
 * label on it is 2.59:1 — the token is what keeps that correct.
 *
 * Focus is never restyled. The global `:focus-visible` outline applies to every
 * control in the product so it cannot drift between screens.
 *
 * Size is expressed through the `--control-*` density properties, so switching
 * to compact density shrinks every button in the product at once.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap',
    'rounded-md font-medium transition-colors duration-[--duration-fast] ease-[--ease-standard]',
    'disabled:pointer-events-none disabled:cursor-not-allowed',
    'aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-on-fill hover:bg-brand-hover active:bg-brand-active',
        secondary:
          'border border-control bg-surface text-primary hover:bg-surface-hover active:bg-surface-selected',
        // Tertiary has no resting box. Used for the majority of staff actions,
        // where a wall of filled buttons would make the primary path unclear.
        tertiary: 'text-brand-ink hover:bg-surface-hover active:bg-surface-selected',
        danger: 'bg-status-critical text-on-fill hover:brightness-95 active:brightness-90',
        ghost: 'text-secondary hover:bg-surface-hover hover:text-primary',
      },
      size: {
        sm: 'h-[--control-height-sm] px-[calc(var(--control-px)*0.75)] text-meta',
        md: 'h-[--control-height] px-[--control-px] text-body',
        lg: 'h-[--control-height-lg] px-[calc(var(--control-px)*1.25)] text-body',
        // Public layer primary target. Brief 2.6 requires >= 56px on patient-facing
        // surfaces; the density block already sets this, this variant just states it.
        publicCta: 'h-[var(--control-height-lg)] px-7 text-public-body min-h-14',
        icon: 'size-[--control-height] p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the single child element instead of a `<button>`. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      // Buttons inside a form default to submit, which has caused real incident
      // reports in similar systems. Default to `button`, require opt-in.
      type={asChild ? undefined : (type ?? 'button')}
      data-disabled={props.disabled || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
