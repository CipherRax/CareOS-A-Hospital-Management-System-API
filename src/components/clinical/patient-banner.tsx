'use client';

import { useId, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { cn } from '@/lib/cn';

/**
 * PatientBanner.
 *
 * Brief §2.4: "persistent header inside any patient context". Its job is to answer
 * "am I looking at the right person?" in about a second, because that is the
 * question a clinician asks before every action and a wrong answer is a safety
 * event.
 *
 * **The allergy states are the reason this is a discriminated union.** The brief is
 * blunt: absence of a record must never read as "no allergies". Three states exist
 * and they mean different things:
 *
 *   - `recorded` — allergies are on file. Critical styling, expandable.
 *   - `none-recorded` — someone looked and recorded that there are none.
 *   - `not-recorded` — nobody has ever asked. The most dangerous of the three, and
 *     the one a naive `allergies?.length` check renders as *nothing at all*,
 *     which a reader takes as reassurance.
 *
 * Encoding this as one union means a caller cannot pass `allergies: []` and get a
 * reassuring empty state by accident, and cannot omit the field without the type
 * complaining. The distinction survives review because it is in the types.
 *
 * Also deliberate:
 *
 *  - Age comes from the caller, never computed here. The fixture set deliberately
 *    contains inconsistent date formats, and silently guessing a birth date's format
 *    to derive an age is how a banner starts disagreeing with the record.
 *  - The patient number is never truncated. Two patients can share a name; the
 *    reference is what disambiguates them.
 *  - Legal hold and possible-duplicate are distinct from clinical risk flags. They
 *    mean different things to different people, and a nurse does not need to be told
 *    that a legal hold means a record may be under review.
 *  - Not a card with a shadow. This is a header; elevation would make it compete
 *    with the clinical content below it.
 */

export type AllergyState =
  | { status: 'recorded'; allergies: readonly string[] }
  | { status: 'none-recorded' }
  | { status: 'not-recorded' };

export interface PatientBannerProps {
  patient: {
    reference: string;
    displayName: string;
    /** Free-text date of birth as recorded. Never reformatted or inferred. */
    dateOfBirth: string;
    /** Age in years, as the API reports it. Not derived here. */
    age?: number;
    sex: string;
    allergies: AllergyState;
    /** Clinical risk flags such as "falls risk". Not legal or duplicate markers. */
    flags?: readonly string[];
    /** A legal hold is on this record. */
    legalHold?: boolean;
    /** The records team flagged this as a possible duplicate. */
    possibleDuplicate?: boolean;
    /** Where the patient is now, e.g. "In ward, bed 4". */
    location?: string;
    insurance?: {
      providerName: string;
      scheme?: string;
      memberNumber?: string;
    };
    statusLabel: string;
    statusTone: StatusTone;
  };
  /**
   * Heading level for the patient name. `1` on a real patient screen, because that
   * is the page's subject. Not hardwired: the design-system page shows several
   * banners under an `h2`, and three `h1`s nested mid-page are a heading-order
   * violation rather than a style question.
   */
  headingLevel?: 1 | 2 | 3 | 4;
  className?: string;
}

export function PatientBanner({ patient, headingLevel = 1, className }: PatientBannerProps) {
  const [allergiesOpen, setAllergiesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Generated, not hardcoded: a page can hold more than one banner — the
  // design-system showcase does — and three sections all claiming
  // `aria-labelledby={headingId}` means three landmarks with the same
  // name, which is both a duplicate id and an axe failure.
  const headingId = useId();
  // A string, so the caller chooses the level: React needs a capitalised
  // component name, and `h${level}` is resolved as an intrinsic element.
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4';

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(patient.reference);
      setCopied(true);
      // Cleared rather than left saying "copied" forever; the state is a
      // confirmation, not a fact about the record.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by policy or unavailable on an insecure
      // origin. The number is on screen and selectable; saying nothing is better
      // than reporting a failure the person cannot act on.
    }
  }

  const hasRecordFlags =
    patient.legalHold || patient.possibleDuplicate || Boolean(patient.flags?.length);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('border-b border-border bg-surface px-6 py-4', className)}
    >
      {/* Safety notices first, in document order, so a screen reader meets the
          allergy before the demographics. */}
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <AllergyNotice
          state={patient.allergies}
          open={allergiesOpen}
          onToggle={() => setAllergiesOpen((value) => !value)}
        />

        {patient.legalHold ? (
          <StatusPill
            tone="warning"
            label="Legal hold"
            size="sm"
            title="This record is subject to a legal hold"
          />
        ) : null}

        {patient.possibleDuplicate ? (
          <StatusPill
            tone="info"
            label="Possible duplicate"
            size="sm"
            title="The records team has flagged this as a possible duplicate"
          />
        ) : null}

        {patient.flags?.map((flag) => (
          <StatusPill
            key={flag}
            tone="warning"
            label={flag}
            size="sm"
            title="Recorded clinical risk flag"
          />
        ))}

        {hasRecordFlags ? <AuditHint /> : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <Heading id={headingId} className="text-heading font-semibold text-primary">
            {patient.displayName}
          </Heading>
          {/* Read as one identifying line rather than four announced terms, so this
              is a paragraph and not a description list. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-meta text-secondary">
            <span className="inline-flex items-center gap-1">
              <span className="font-mono text-primary">{patient.reference}</span>
              <button
                type="button"
                onClick={copyReference}
                className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-caption text-tertiary hover:bg-surface-hover hover:text-primary"
              >
                {copied ? (
                  <Check aria-hidden className="size-3.5" strokeWidth={1.5} />
                ) : (
                  <Copy aria-hidden className="size-3.5" strokeWidth={1.5} />
                )}
                <span className="sr-only">
                  {copied
                    ? `${patient.reference} copied`
                    : `Copy patient number ${patient.reference}`}
                </span>
              </button>
            </span>
            <span aria-hidden="true">·</span>
            <span>{patient.dateOfBirth}</span>
            {patient.age !== undefined ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{patient.age} years</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>{patient.sex}</span>
            {patient.location ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-primary">{patient.location}</span>
              </>
            ) : null}
          </p>
          <CopiedStatus copied={copied} reference={patient.reference} />
        </div>

        <div className="flex flex-col items-end gap-1">
          <StatusPill tone={patient.statusTone} label={patient.statusLabel} />
          {patient.insurance ? (
            <p className="text-caption text-secondary">
              {patient.insurance.scheme
                ? `${patient.insurance.providerName} · ${patient.insurance.scheme}`
                : patient.insurance.providerName}
              {patient.insurance.memberNumber ? (
                <span className="ml-1 font-mono">{patient.insurance.memberNumber}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AllergyNotice({
  state,
  open,
  onToggle,
}: {
  state: AllergyState;
  open: boolean;
  onToggle: () => void;
}) {
  if (state.status === 'recorded') {
    const count = state.allergies.length;
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-md border border-status-critical bg-status-critical-bg px-2 py-1 text-caption font-medium text-status-critical hover:brightness-[0.98]"
        >
          Allergies: {count} recorded
        </button>
        {open ? (
          <ul className="flex flex-wrap gap-1.5">
            {state.allergies.map((allergy) => (
              <li
                key={allergy}
                className="rounded-md border border-status-critical px-2 py-0.5 text-caption text-primary"
              >
                {allergy}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    );
  }

  // Both remaining states are deliberately worded differently. "No known
  // allergies" and "no allergy record" are not the same claim, and a reader in a
  // hurry must not be able to confuse them.
  return (
    <StatusPill
      tone={state.status === 'none-recorded' ? 'success' : 'warning'}
      size="sm"
      label={
        state.status === 'none-recorded'
          ? 'No known allergies recorded'
          : 'Allergies not yet recorded'
      }
      title={
        state.status === 'none-recorded'
          ? 'Checked and recorded as none'
          : 'No allergy record exists for this patient. Confirm before prescribing.'
      }
    />
  );
}

function AuditHint() {
  return (
    <StatusPill
      tone="neutral"
      size="sm"
      label="Access is logged"
      title="Viewing this record is recorded"
    />
  );
}

function CopiedStatus({ copied, reference }: { copied: boolean; reference: string }) {
  // A polite live region so the confirmation is heard rather than only seen.
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {copied ? `${reference} copied to the clipboard` : ''}
    </span>
  );
}
