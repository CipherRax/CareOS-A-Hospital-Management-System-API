'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';

/**
 * Field primitives: label, control, hint, error.
 *
 * Sizing comes from the `--control-*` density properties, and the resting border
 * is `border-control` rather than `border`. That is not cosmetic: `border` is
 * 1.37:1 on surface, which fails WCAG 1.4.11, so a form built on it would be
 * unusable for low-vision staff. See DESIGN.md "Deliberate deviations".
 *
 * Validation is never colour-only. An invalid field gets a warning icon and an
 * error message linked by `aria-describedby`, and `aria-invalid` is set for
 * assistive technology.
 */
export const controlVariants = cva(
  [
    'w-full bg-surface text-primary placeholder:text-tertiary',
    'border border-control rounded-md',
    'transition-colors duration-[--duration-fast] ease-[--ease-standard]',
    'hover:border-border-strong',
    'disabled:bg-surface-sunken disabled:text-disabled disabled:cursor-not-allowed disabled:hover:border-control',
    'read-only:bg-surface-sunken',
    'aria-[invalid=true]:border-status-critical',
  ],
  {
    variants: {
      controlSize: {
        sm: 'h-[--control-height-sm] px-[calc(var(--control-px)*0.75)] text-meta',
        md: 'h-[--control-height] px-[--control-px] text-input',
        // Public layer: 18px type, >= 48px target, 16px radius. Never below the
        // brief's 2.6 floor regardless of staff density.
        public:
          'min-h-14 px-[calc(var(--control-px)*1.5)] py-3 text-public-body rounded-[--radius-public]',
      },
    },
    defaultVariants: { controlSize: 'md' },
  },
);

export function Label({
  className,
  required,
  children,
  ...props
}: {
  className?: string;
  required?: boolean;
  children: ReactNode;
} & React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('flex items-center gap-1 text-meta font-medium text-secondary', className)}
      {...props}
    >
      {children}
      {required ? (
        // Announced as "required" rather than shown as a bare asterisk.
        <>
          <span aria-hidden="true" className="text-status-critical">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </label>
  );
}

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  controlSize?: NonNullable<VariantProps<typeof controlVariants>['controlSize']>;
  className?: string;
  children: (ids: {
    controlId: string;
    describedBy: string | undefined;
    invalid: boolean;
    controlSize: NonNullable<VariantProps<typeof controlVariants>['controlSize']>;
  }) => ReactNode;
}

/**
 * Wires up label/hint/error relationships once so no field has to remember to.
 * Returns ids to the caller rather than owning the control, which keeps the
 * control itself a plain element that can be an input, select or textarea.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  controlSize = 'md',
  className,
  children,
}: FieldShellProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-[calc(var(--field-gap)*0.4)]', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({ controlId: id, describedBy, invalid, controlSize })}
      {hint ? (
        <p id={hintId} className="text-caption text-tertiary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-caption text-status-critical">
          {/* Icon, not colour alone. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="mt-px size-3.5 shrink-0 fill-current"
          >
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4.5Zm0 7.25a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
          </svg>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlVariants(), className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(controlVariants(), 'h-auto resize-y py-2 leading-[1.45]', className)}
      {...props}
    />
  );
});

/**
 * Native select. Deliberately not a Radix listbox in F0: the native control
 * gets platform pickers, correct mobile behaviour and screen-reader support for
 * free. A custom listbox is one of the biggest sources of accessibility defects
 * in clinical software, so it needs evidence before it replaces this.
 */
export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(controlVariants(), 'appearance-none pr-9', className)}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 fill-none stroke-text-secondary stroke-[1.5]"
      >
        <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

/** Convenience wrapper for the common uncontrolled case. */
export function LabelledInput({
  label,
  hint,
  error,
  required,
  ...props
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {({ controlId, describedBy, invalid }) => (
        <Input id={controlId} aria-describedby={describedBy} invalid={invalid} {...props} />
      )}
    </Field>
  );
}
