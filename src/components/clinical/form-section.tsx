import { cn } from '@/lib/cn';

/**
 * Grouped form section.
 *
 * A real `<fieldset>` with a `<legend>`, not a `<div>` with a heading styled to look
 * like one. The browser and assistive technology both treat a fieldset as a named
 * group of controls, which is what a section of a form is, and that grouping is
 * what lets a screen reader user answer "what is this group for" without reading
 * every label in it.
 *
 * `description` is wired to the group through `aria-describedby` rather than left
 * as loose prose, so it is announced with the group instead of being skipped.
 */

export interface FormSectionProps {
  title: string;
  description?: string;
  /** Renders the legend as a required marker. For groups that must be completed. */
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({
  title,
  description,
  required,
  children,
  className,
}: FormSectionProps) {
  // Stable across renders: the id is written into `aria-describedby`, and a value
  // that changes per render would make the association a guess rather than a fact.
  const descriptionId = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <fieldset
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        'min-w-0 border-0 border-t border-border p-0 pt-5 first:border-t-0 first:pt-0',
        className,
      )}
    >
      <legend className="mb-1 flex items-baseline gap-2 text-body font-semibold text-primary">
        {title}
        {required ? (
          <span className="text-caption uppercase tracking-wide text-secondary">Required</span>
        ) : null}
      </legend>
      {description ? (
        <p id={descriptionId} className="mb-4 max-w-prose text-meta text-secondary">
          {description}
        </p>
      ) : null}
      <div className="flex flex-col gap-4">{children}</div>
    </fieldset>
  );
}
