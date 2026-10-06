'use client';

import { useState } from 'react';

import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { buttonVariants } from '@/components/ui/button';
import { ReasonField, reasonError } from './reason-field';

/**
 * Break-glass access request.
 *
 * Emergency access to a record the user's role cannot normally open. Brief §5: it
 * requires a reason, shows the consequences, and while a grant is active the user
 * sees an unmistakable banner with time remaining.
 *
 * Two deliberate choices:
 *
 *  - **The consequences are stated before the button, not after.** What a person
 *    reads after they have committed is not a warning. They need to know that this
 *    is recorded, that it appears in an audit, and that it may be reviewed, *while*
 *    deciding.
 *  - **The confirm button is a verb — "Request emergency access".** Not "OK", not
 *    "Confirm". Someone who has been shown a list of consequences should not then be
 *    asked to approve something unnamed.
 *
 * This dialog does not grant access; it requests it. Whether the API grants it, and
 * on what terms, is the server's decision. The dialog therefore does not promise a
 * duration — that would be inventing a contract.
 *
 * `BreakGlassBanner` is the other half: the persistent, unmistakable marker while a
 * grant is live. A dialog that requests access and then leaves no trace on screen
 * means someone keeps working under emergency access without knowing it.
 */

export interface BreakGlassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being accessed, named. "the patient record" is not specific enough. */
  resourceLabel: string;
  onRequest: (reason: string) => void | Promise<void>;
  pending?: boolean;
}

export function BreakGlassDialog({
  open,
  onOpenChange,
  resourceLabel,
  onRequest,
  pending,
}: BreakGlassDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason('');
    setError(null);
    onOpenChange(false);
  }

  return (
    // Closing for any reason — Escape, the scrim, Cancel — clears the reason. Left
    // behind, the next person to open this for a different patient would find the
    // previous patient's justification already filled in, which is exactly the sort
    // of thing that ends up copied.
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader
          title="Request emergency access"
          description={`This opens ${resourceLabel} outside your normal permissions.`}
        />
        <DialogBody className="flex flex-col gap-4">
          {/* Consequences first. The point of this dialog is that the cost is known
              before the decision, not discovered in an audit a month later. */}
          <ul className="flex flex-col gap-2 border border-border bg-surface-sunken p-3">
            {[
              'Your name, the time and the record are recorded.',
              'This access appears in the audit log and may be reviewed.',
              'The request is refused if your role cannot hold emergency access.',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-meta text-secondary">
                <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-tertiary" />
                {line}
              </li>
            ))}
          </ul>

          <ReasonField value={reason} onChange={setReason} error={error} />
        </DialogBody>
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: 'secondary' })}>Cancel</DialogClose>
          <button
            type="button"
            disabled={pending}
            className={buttonVariants({ variant: 'danger' })}
            onClick={() => {
              // Validate here rather than disabling the button: a disabled button
              // with no explanation is the most common dead end in a clinical tool,
              // and the person cannot tell what the button wants.
              const problem = reasonError(reason);
              setError(problem);
              if (problem) return;
              void onRequest(reason.trim());
            }}
          >
            {pending ? 'Requesting' : 'Request emergency access'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface BreakGlassBannerProps {
  /** Minutes left, where the API supplies it. Omitted rather than guessed. */
  minutesRemaining?: number;
  onEnd: () => void;
  className?: string;
}

/**
 * The active-grant banner.
 *
 * Unmissable by design: this is the brief's "safety is visible" principle applied to
 * the person who already bypassed a control. It carries a shape and a word as well
 * as a colour, so it survives greyscale, and it names the record so a clinician
 * halfway through a consultation can see which patient they are looking at under an
 * emergency grant.
 */
export function BreakGlassBanner({ minutesRemaining, onEnd, className }: BreakGlassBannerProps) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-2 border-status-warning bg-status-warning-bg px-4 py-3 ${className ?? ''}`}
    >
      <span className="text-body font-semibold text-status-warning">Emergency access active</span>
      <span className="text-meta text-primary">
        You are viewing this record outside your normal permissions.
        {minutesRemaining !== undefined
          ? ` ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'} remaining.`
          : ''}
      </span>
      <button
        type="button"
        onClick={onEnd}
        className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} ml-auto`}
      >
        End access
      </button>
    </div>
  );
}
