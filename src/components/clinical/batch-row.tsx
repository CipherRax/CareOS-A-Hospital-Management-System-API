import { Undo2 } from 'lucide-react';

import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { cn } from '@/lib/cn';

/**
 * BatchRow.
 *
 * Brief §2.4: a bulk operation with row-level status and a *differential* undo.
 * "Differential" is the whole point: undoing one row must not touch the other rows,
 * and a row that undoes must not depend on what else happened in the batch.
 *
 * Two failures this component refuses to make:
 *
 *  - **Batch-wide state.** A "batch succeeded" banner on a hundred rows where three
 *    failed is how a corrupt subset becomes official. State is per row, visible on
 *    the row, and the summary counts from the rows. It never globalises.
 *  - **Undo that re-runs the task.** Undoing a failed row by retrying a task that
 *    failed is how a medication gets administered twice. Undo is available only on
 *    `succeeded` rows, and it is a distinct callback from the operation itself.
 *
 * Rendering state, not performing it. The component takes the row states from the
 * caller — it composes a view of a batch, and the API is the authority on whether
 * a row actually applied or reverted. Nothing here mutates anything.
 *
 * Iconography: the succeeded row carries a check, failed a stop, reverted an undo
 * mark, pending a spinner. Never colour alone.
 */

export type BatchRowState = 'pending' | 'succeeded' | 'failed' | 'reverted';

export interface BatchRowItem {
  /**
   * Stable identifier; the row's identity.
   *
   * Deliberately not `key`: React strips the reserved `key` prop before it ever
   * reaches a component, so a row identity carried as `key` arrives as
   * `undefined` and an undo would be issued against a nameless row.
   */
  rowId: string;
  /** What the row is, named: "Amoxicillin 500 mg TDS" not "item". */
  label: string;
  /** Optional second line, e.g. the record the row touched. */
  detail?: string;
}

export interface BatchRowProps extends BatchRowItem {
  state: BatchRowState;
  /** The reason a `failed` row failed. Shown as the row's message. */
  error?: string;
  /** Called only when the row is `succeeded`. */
  onUndo?: (item: BatchRowItem) => void;
  className?: string;
}

const STATE_TONE: Record<BatchRowState, StatusTone> = {
  pending: 'neutral',
  succeeded: 'success',
  failed: 'critical',
  reverted: 'info',
};

const STATE_LABEL: Record<BatchRowState, string> = {
  pending: 'Pending',
  succeeded: 'Applied',
  failed: 'Failed',
  reverted: 'Reverted',
};

export function BatchRow({ rowId, label, detail, state, error, onUndo, className }: BatchRowProps) {
  const canUndo = state === 'succeeded' && onUndo;
  return (
    <li
      className={cn(
        'flex items-center justify-between gap-3 border border-border bg-surface px-3 py-2',
        state === 'failed' ? 'border-status-critical' : '',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <StateGlyph state={state} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-body text-primary">{label}</p>
          {detail ? <p className="truncate text-caption text-secondary">{detail}</p> : null}
          {/* The failure message is the row's own message, on the row that failed.
              A wall of errors in a footer, detached from their rows, is the same
              globalising failure as a batch-wide status. */}
          {error ? <p className="truncate text-caption text-status-critical">{error}</p> : null}
        </div>

        <StatusPill tone={STATE_TONE[state]} label={STATE_LABEL[state]} size="sm" />
      </div>

      {canUndo ? (
        <button
          type="button"
          onClick={() => onUndo({ rowId, label, detail })}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium text-primary hover:bg-surface-hover"
        >
          <Undo2 aria-hidden className="size-3.5" strokeWidth={1.5} />
          Undo
        </button>
      ) : null}
    </li>
  );
}

function StateGlyph({ state }: { state: BatchRowState }) {
  if (state === 'pending') {
    // A progress spinner, for a row whose outcome is still open.
    return (
      <span
        aria-hidden
        className="size-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-brand"
      />
    );
  }
  if (state === 'succeeded') {
    return (
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success"
      >
        <CheckMark />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-status-critical-bg text-status-critical"
      >
        <StopMark />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-hover text-secondary"
    >
      <UndoMark />
    </span>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 10 10"
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="m2 5.5 2 2 4-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopMark() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor">
      <rect x="2" y="2" width="6" height="6" rx="1" />
    </svg>
  );
}

function UndoMark() {
  return (
    <svg
      viewBox="0 0 10 10"
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path
        d="M2.5 6.5V3.7h2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="scale(-1,1) translate(-10,0)"
      />
      <path
        d="M3 7a4 4 0 1 0 .3-1.2"
        strokeLinecap="round"
        transform="scale(-1,1) translate(-10,0)"
      />
    </svg>
  );
}
