'use client';

import { useId } from 'react';

import { Field, Textarea } from '@/components/ui/field';

/**
 * Reason capture.
 *
 * Shared by `BreakGlassDialog`, `AmendmentDialog` and the duplicate-review flow,
 * because they share the same rule and the same failure mode: the reason is the
 * only part of the record that makes the action defensible months later, and it is
 * the part people skip under time pressure.
 *
 * **The reason is required, and validation belongs to the caller.** `error` is a
 * prop rather than internal state so that one place decides whether the dialog is a
 * reason-gated action at all, and the submit button and the field cannot disagree
 * about it. An internally-validated field next to a caller-validated submit is how
 * you get a dialog that says "reason required" while the button happily fires.
 *
 * Validation therefore runs on submit, not per keystroke. Flagging an empty box
 * while someone is still reading the question is how people learn to dismiss the
 * message without reading it.
 *
 * The minimum length is 10 characters, not an arbitrary gate: a one-word reason is
 * not a record, and "as above" or "urgent" satisfies a bare required check while
 * telling an auditor nothing.
 *
 * `placeholder` is a worked example rather than a hint. It shows the kind of answer
 * wanted, which is the difference between a box someone fills in and a box someone
 * fills with whatever clears it fastest.
 */

export interface ReasonFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Supplied by the caller from `reasonError` on submit. */
  error?: string | null;
  minLength?: number;
  label?: string;
  hint?: string;
  placeholder?: string;
  id?: string;
}

export const REASON_MIN_LENGTH = 10;

export function ReasonField({
  value,
  onChange,
  error,
  label = 'Reason',
  hint = 'Recorded against your account, with the time and the action taken.',
  placeholder = 'For example: patient identified by date of birth, next of kin confirmed by telephone.',
  id,
}: ReasonFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? `reason-${generatedId}`;

  return (
    <Field id={fieldId} label={label} hint={hint} error={error ?? undefined} required>
      {({ controlId, describedBy, invalid }) => (
        <Textarea
          id={controlId}
          aria-describedby={describedBy}
          invalid={invalid}
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** The shared rule, so the dialogs and the field cannot drift apart. */
export function reasonError(value: string, minLength = REASON_MIN_LENGTH): string | null {
  return value.trim().length >= minLength
    ? null
    : `Give a reason of at least ${minLength} characters. It is recorded with this action.`;
}
