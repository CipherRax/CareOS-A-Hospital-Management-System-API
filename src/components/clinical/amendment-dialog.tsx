'use client';

import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { ReasonField, reasonError } from './reason-field';

/**
 * Amendment of a finalized clinical note or result.
 *
 * Brief §2.4: "for finalized clinical notes/results: shows what will change,
 * requires a reason, and makes clear the original is preserved."
 *
 * All three of those are the dialog's job, and the ordering is the design:
 *
 *  1. **What will change, shown as a diff.** Not a description of the change — the
 *     actual old and new text, side by side. A clinician amending a note needs to
 *     check they are amending the sentence they meant to, and prose summaries hide
 *     exactly the wrong edits.
 *  2. **That the original is kept.** Stated plainly, because the fear behind an
 *     amendment is destroying the record, and that fear is what makes people avoid
 *     the action and write a second note instead.
 *  3. **The reason**, required.
 *
 * The confirm button is "Amend record", not "OK".
 *
 * This composes an amendment; it does not perform one. Nothing here edits a
 * finalized record in place — brief §14 is explicit that notes and results are
 * never edited in place, and the server enforces that. The dialog's job is to make
 * sure nobody believes otherwise.
 */

export interface AmendmentChange {
  /** Field or section label, e.g. "Assessment". */
  field: string;
  /** The current finalized text. */
  before: string;
  /** The text that will be recorded as the amendment. */
  after: string;
}

export interface AmendmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being amended, named: "the consultation note from 5 October". */
  resourceLabel: string;
  changes: readonly AmendmentChange[];
  onAmend: (reason: string) => void | Promise<void>;
  pending?: boolean;
}

export function AmendmentDialog({
  open,
  onOpenChange,
  resourceLabel,
  changes,
  onAmend,
  pending,
}: AmendmentDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason('');
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader
          title="Amend a finalized record"
          description={`This adds an amendment to ${resourceLabel}.`}
        />
        <DialogBody className="flex flex-col gap-4">
          <ul className="flex flex-col gap-4">
            {changes.map((change) => (
              <li key={change.field} className="flex flex-col gap-2">
                <p className="text-caption uppercase tracking-wide text-tertiary">{change.field}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1 border border-border bg-surface-sunken p-3">
                    <p className="text-caption uppercase tracking-wide text-tertiary">Current</p>
                    {/* Preserved and legible, not struck through: this text stays in
                        the record and someone will need to read it exactly as
                        written, not as a diff artifact. */}
                    <p className="whitespace-pre-wrap text-body text-secondary">{change.before}</p>
                  </div>
                  <div className="flex flex-col gap-1 border border-brand bg-surface-selected p-3">
                    <p className="text-caption uppercase tracking-wide text-secondary">Amendment</p>
                    <p className="whitespace-pre-wrap text-body text-primary">{change.after}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="border-l-2 border-border-strong pl-3 text-meta text-secondary">
            The original text is preserved and remains readable. This amendment is added as a new
            version with your name, the time and the reason below.
          </p>

          <ReasonField
            value={reason}
            onChange={setReason}
            error={error}
            label="Reason for the amendment"
            hint="Shown alongside your name wherever this version is displayed."
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: 'secondary' })}>Cancel</DialogClose>
          <button
            type="button"
            disabled={pending}
            className={buttonVariants({ variant: 'danger' })}
            onClick={() => {
              const problem = reasonError(reason);
              setError(problem);
              if (problem) return;
              void onAmend(reason.trim());
            }}
          >
            {pending ? 'Amending' : 'Amend record'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
