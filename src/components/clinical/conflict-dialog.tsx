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
import { KeyValueGrid } from './key-value-grid';
import { ReasonField, reasonError } from './reason-field';

/**
 * Version conflict resolution, for `409 VERSION_CONFLICT`.
 *
 * Brief §2.4: "shows server version vs the user's changes side by side; user
 * resolves explicitly."
 *
 * There is deliberately **no default resolution**. Not "keep mine", not "keep
 * theirs", not a merge. Two clinicians editing one record and having the UI pick a
 * winner silently is how a corrected dose gets overwritten by a stale form, and the
 * person who lost the edit has no way to know it happened.
 *
 * So the person has to choose, per field, and say why. Fields that only one side
 * changed are offered as "no conflict" and can be taken without ceremony; the dialog
 * lists every field either way, because a field missing from the list reads as
 * "unchanged" whether it is or not.
 *
 * `serverVersion`/`yourVersion` are shown because "someone else changed this" is not
 * actionable on its own — knowing it was version 7 when you loaded and is now
 * version 8 is.
 *
 * The API is still the authority: this composes a resolution, it does not perform
 * one, and a conflict can recur between opening this dialog and submitting.
 */

export type ConflictResolution = 'mine' | 'theirs';

export interface ConflictField {
  field: string;
  /** Value on the server now. */
  server: string;
  /** Value in the user's unsubmitted form. */
  mine: string;
}

export interface ConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceLabel: string;
  serverVersion: string | number;
  yourVersion: string | number;
  fields: readonly ConflictField[];
  onResolve: (choice: Record<string, ConflictResolution>, reason: string) => void | Promise<void>;
  pending?: boolean;
}

export function ConflictDialog({
  open,
  onOpenChange,
  resourceLabel,
  serverVersion,
  yourVersion,
  fields,
  onResolve,
  pending,
}: ConflictDialogProps) {
  const [choice, setChoice] = useState<Record<string, ConflictResolution>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close() {
    setChoice({});
    setReason('');
    setError(null);
    onOpenChange(false);
  }

  function pick(field: string, value: ConflictResolution) {
    setChoice((current) => ({ ...current, [field]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader
          title="This record changed while you were editing"
          description={`${resourceLabel} was updated by someone else. Choose what to keep for each field.`}
        />
        <DialogBody className="flex flex-col gap-4">
          <KeyValueGrid
            label="Versions"
            columns={2}
            items={[
              { label: 'Version you loaded', value: String(yourVersion), mono: true },
              { label: 'Version on the server', value: String(serverVersion), mono: true },
            ]}
          />

          <ul className="flex flex-col gap-4">
            {fields.map((field) => {
              const picked = choice[field.field] ?? 'mine';
              // A field both sides left alone is not a conflict. It is still listed,
              // because an absent field reads as "unchanged" either way.
              const unchanged = field.server === field.mine;
              return (
                <li key={field.field} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-caption uppercase tracking-wide text-tertiary">
                      {field.field}
                    </p>
                    {unchanged ? (
                      <p className="text-caption text-secondary">Unchanged by either side</p>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <ConflictChoice
                      field={field.field}
                      side="theirs"
                      heading="On the server"
                      value={field.server}
                      selected={picked === 'theirs'}
                      onSelect={() => pick(field.field, 'theirs')}
                    />
                    <ConflictChoice
                      field={field.field}
                      side="mine"
                      heading="Your version"
                      value={field.mine}
                      selected={picked === 'mine'}
                      onSelect={() => pick(field.field, 'mine')}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <ReasonField
            value={reason}
            onChange={setReason}
            error={error}
            label="Reason for the resolution"
            hint="Recorded with both versions, so the next person to read this knows why it was resolved this way."
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: 'secondary' })}>Cancel</DialogClose>
          <button
            type="button"
            disabled={pending}
            className={buttonVariants({ variant: 'primary' })}
            onClick={() => {
              const problem = reasonError(reason);
              setError(problem);
              if (problem) return;
              void onResolve(choice, reason.trim());
            }}
          >
            {pending ? 'Resolving' : 'Resolve with these versions'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConflictChoice({
  field,
  side,
  heading,
  value,
  selected,
  onSelect,
}: {
  field: string;
  side: ConflictResolution;
  heading: string;
  value: string;
  selected: boolean;
  onSelect: () => void;
}) {
  // A radio group per field, not a pair of buttons: a screen reader should be able
  // to say "3 of 6" and let the person arrow through the options.
  const name = `conflict-${field}`;
  return (
    <fieldset
      className={`flex flex-col gap-2 border p-3 ${
        selected ? 'border-brand bg-surface-selected' : 'border-border bg-surface'
      }`}
    >
      <legend className="px-1 text-caption uppercase tracking-wide text-tertiary">{heading}</legend>
      <label className="flex items-start gap-2 text-body text-primary">
        <input
          type="radio"
          name={name}
          checked={selected}
          onChange={onSelect}
          className="mt-1 size-4 accent-[var(--c-brand)]"
          data-side={side}
        />
        <span className="min-w-0 break-words">{value}</span>
      </label>
    </fieldset>
  );
}
