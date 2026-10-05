'use client';

import { StatusPill, type StatusTone } from '@/components/staff/status-pill';
import { cn } from '@/lib/cn';

/**
 * PatientHeader.
 *
 * The identity banner that sits at the top of every screen concerning one
 * patient. Its job is to answer "am I looking at the right person?" in about a
 * second, because that is the question a clinician asks before every action and a
 * wrong answer is a safety event.
 *
 * That drives three decisions:
 *
 *  - The patient name is the largest thing on the page. Nothing competes with it.
 *  - Identifiers are given in full, not truncated. Two patients can share a name;
 *    the reference is what disambiguates, so ellipsising it defeats the purpose.
 *  - Allergy and risk flags come before any clinical detail, and are never
 *    colour-only.
 *
 * Deliberately not a card with a shadow. A patient banner is a header, and giving
 * it elevation would make it compete with the clinical content underneath it.
 */

export interface PatientHeaderProps {
  patient: {
    reference: string;
    displayName: string;
    /** Free-text date of birth as recorded; not reformatted or inferred. */
    dateOfBirth: string;
    sex: string;
    /** Shown as a warning when present. Never rendered as a diagnosis. */
    allergies?: readonly string[];
    /** Risk flags such as "falls risk" or "DNR". */
    flags?: readonly string[];
    statusLabel: string;
    statusTone: StatusTone;
  };
  className?: string;
}

export function PatientHeader({ patient, className }: PatientHeaderProps) {
  const hasSafetyNotice = patient.allergies?.length || patient.flags?.length;

  return (
    <section
      aria-labelledby="patient-header-name"
      className={cn('border-b border-border bg-surface px-6 py-4', className)}
    >
      {/* Safety notices first, in document order, so a screen reader reaches the
          allergy before the demographics. */}
      {hasSafetyNotice ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {patient.allergies?.map((allergy) => (
            <StatusPill
              key={allergy}
              tone="critical"
              label={`Allergy: ${allergy}`}
              size="sm"
              title="Recorded allergy — check before prescribing"
            />
          ))}
          {patient.flags?.map((flag) => (
            <StatusPill
              key={flag}
              tone="warning"
              label={flag}
              size="sm"
              title="Recorded clinical risk flag"
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 id="patient-header-name" className="text-heading font-semibold text-primary">
            {patient.displayName}
          </h1>
          {/* Not a definition list: these are read as a single identifying line,
              and a dl would announce four separate terms. */}
          <p className="mt-1 text-meta text-secondary">
            <span className="font-mono text-primary">{patient.reference}</span>
            <span aria-hidden="true"> · </span>
            <span>{patient.dateOfBirth}</span>
            <span aria-hidden="true"> · </span>
            <span>{patient.sex}</span>
          </p>
        </div>
        <StatusPill tone={patient.statusTone} label={patient.statusLabel} />
      </div>
    </section>
  );
}
