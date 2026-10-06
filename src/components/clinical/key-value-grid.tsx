import { cn } from '@/lib/cn';

/**
 * Key/value detail grid.
 *
 * A `<dl>`, because the pairs here are genuinely term/definition relationships —
 * "Patient number: LAB-…" — and a table of `<div>`s would throw that away. Chrome
 * and VoiceOver both let a user navigate a `<dl>`'s terms directly, which on a
 * patient record is most of the point.
 *
 * `mono` is for patient numbers, sample IDs, batch numbers, invoice numbers and
 * M-PESA references. Those are identifiers and amounts that get read aloud, copied
 * into other systems and compared digit by digit, and proportional figures make a
 * 1 look like a 7. The brief calls for tabular figures everywhere for the same
 * reason.
 *
 * An empty value renders as an em dash rather than as nothing. A blank cell in a
 * clinical record is ambiguous between "not recorded" and "not applicable", and an
 * em dash at least marks the spot as deliberately empty — see `PatientBanner` for
 * the allergy case, where the brief is blunter: absence of a record must never read
 * as absence of the thing.
 */

export interface KeyValueItem {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  /** Rendered on its own line under the pair. For a qualifier or a caveat. */
  note?: string;
  /** Stretches the pair across both columns. For something long. */
  wide?: boolean;
}

/** Absent for the purpose of display: null, undefined, empty or whitespace only. */
function isBlank(value: React.ReactNode): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

export interface KeyValueGridProps {
  items: readonly KeyValueItem[];
  /** 2 suits a record header; 3 suits a summary strip. */
  columns?: 2 | 3;
  /** Visible caption above the grid. */
  label?: string;
  className?: string;
}

export function KeyValueGrid({ items, columns = 2, label, className }: KeyValueGridProps) {
  return (
    <div className="min-w-0">
      {/* A visible caption, not `aria-label` on the list. A `<dl>` has no implicit
          ARIA role, so a name put on it is not reliably announced — checked against
          the accessibility tree rather than assumed. Prose above the grid is read
          aloud in document order by every screen reader and is legible to everyone
          else, so the name survives either way. */}
      {label ? (
        <p className="mb-3 text-caption uppercase tracking-wide text-tertiary">{label}</p>
      ) : null}

      <dl
        className={cn(
          'grid gap-x-6 gap-y-4',
          columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
          className,
        )}
      >
        {items.map((item) => (
          <div
            key={item.label}
            className={cn('min-w-0', item.wide && 'sm:col-span-2 lg:col-span-3')}
          >
            <dt className="text-caption uppercase tracking-wide text-tertiary">{item.label}</dt>
            <dd
              className={cn(
                'mt-0.5 min-w-0 break-words text-body text-primary',
                item.mono && 'font-mono tabular-nums',
              )}
            >
              {/* `??` is not enough: an empty string is not nullish, so `'' ?? x`
                renders nothing. An API that returns `""` for an unrecorded field
                would leave a blank cell that reads as "not applicable" — the exact
                ambiguity this component exists to remove. Whitespace counts too. */}
              {isBlank(item.value) ? <span className="text-tertiary">—</span> : item.value}
              {item.note ? (
                <span className="mt-0.5 block text-meta text-tertiary">{item.note}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
