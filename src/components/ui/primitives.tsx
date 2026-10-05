'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ Panel */

/**
 * The workhorse container. A border and a surface value, never a shadow —
 * elevation by shadow is explicitly banned, and shadows on stacked panels make
 * dense tables harder to read.
 */
export function Panel({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface', className)} {...props} />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border px-[--row-px] py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-heading-xs font-semibold text-primary">{title}</h2>
        {description ? <p className="mt-0.5 text-caption text-tertiary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */

/**
 * Status chip. Colour is never the only signal: `icon` and the label text
 * always carry the meaning too, which is a hard requirement rather than a
 * preference for clinical safety.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-sunken text-secondary',
        info: 'border-transparent bg-status-info-bg text-status-info',
        success: 'border-transparent bg-status-success-bg text-status-success',
        warning: 'border-transparent bg-status-warning-bg text-status-warning',
        critical: 'border-transparent bg-status-critical-bg text-status-critical',
        brand: 'border-transparent bg-brand-subtle text-brand-ink',
      },
      size: {
        sm: 'px-2 py-0.5 text-caption',
        md: 'px-2.5 py-0.5 text-meta',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export function Badge({
  className,
  tone,
  size,
  icon,
  children,
  ...props
}: { icon?: ReactNode } & ComponentPropsWithoutRef<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- Checkbox */

export const Checkbox = forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer size-4 shrink-0 rounded-xs border border-control bg-surface',
        'transition-colors duration-[--duration-fast]',
        'hover:bg-surface-hover',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-on-fill">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-3.5 fill-none stroke-current stroke-2"
        >
          <path d="m3.5 8.5 3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

/** Checkbox with its label, wired for screen readers. */
export function CheckboxField({
  label,
  description,
  className,
  ...props
}: { label: ReactNode; description?: ReactNode } & React.ComponentPropsWithoutRef<
  typeof CheckboxPrimitive.Root
>) {
  // The label association is what gives the checkbox its accessible name, and it
  // is silently lost if no id is passed — `htmlFor={undefined}` associates nothing
  // and the control is announced as an unlabelled checkbox. So an id is generated
  // rather than assumed. Previously every caller that omitted `id` shipped a
  // nameless control, which axe reports as a critical `button-name` failure.
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const descriptionId = `${id}-description`;
  const describedBy = [props['aria-describedby'], description ? descriptionId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Checkbox id={id} aria-describedby={describedBy || undefined} {...props} />
      <div className="min-w-0">
        <LabelPrimitive.Root htmlFor={id} className="cursor-pointer text-body text-primary">
          {label}
        </LabelPrimitive.Root>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-caption text-tertiary">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Separator */

export const Separator = forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(function Separator({ className, orientation = 'horizontal', decorative = true, ...props }, ref) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
});

/* ---------------------------------------------------------------- Tooltip */

/**
 * Tooltip is supplementary only. Radix renders it as a tooltip role and it is
 * not reachable by keyboard or touch, so it must never hold information that is
 * unavailable elsewhere.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={6}
        className={cn(
          'z-50 max-w-xs rounded-md border border-border bg-surface-raised px-2.5 py-1.5',
          'text-caption text-primary shadow-overlay',
          'data-[state=delayed-open]:animate-none',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/* --------------------------------------------------------------- Skeleton */

/**
 * Loading placeholder. Uses a surface change rather than a shimmer animation:
 * an infinitely animating element is a distraction and a WCAG 2.2.2 concern.
 * `prefers-reduced-motion` would kill the shimmer anyway, leaving a worse
 * placeholder than none.
 */
export function Skeleton({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div aria-hidden="true" className={cn('rounded-md bg-surface-sunken', className)} {...props} />
  );
}
