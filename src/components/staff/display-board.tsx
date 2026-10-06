'use client';

import { NowServing, QueueTicket } from '@/components/clinical/queue-ticket';
import { cn } from '@/lib/cn';

/**
 * DisplayBoard.
 *
 * The waiting-room board. Read from across a room, by someone who is not logged
 * in, on a display that may be washed out by daylight. That drives everything
 * here, and it is why this component is not the triage queue with the padding
 * turned up:
 *
 *  - Large type and wide spacing, because the reader is two to five metres away.
 *  - The current call is the only thing that moves. A board that animates more
 *    than that is unreadable at distance.
 *  - Status is a word and a shape. At this size a subtle tint is invisible, and a
 *    clinician glancing up must not have to interpret a colour.
 *  - Nothing here is a patient identifier beyond the call number. A public
 *    display showing names is a privacy incident waiting to happen.
 *
 * No auto-refresh timer is wired yet: a board that silently changes under a reader
 * needs a decision about whether to announce it, and that decision belongs with the
 * deployment rather than in a component.
 */

export interface DisplayBoardEntry {
  /** Queue reference only — never a patient name. */
  callNumber: string;
  /** Department or clinician label, as displayed. */
  desk: string;
  state: 'now' | 'next' | 'waiting';
}

export interface DisplayBoardProps {
  entries: readonly DisplayBoardEntry[];
  /** Shown as the board heading, e.g. "Outpatient clinics". */
  title: string;
  className?: string;
}

const STATE_STYLE: Record<DisplayBoardEntry['state'], { label: string; className: string }> = {
  now: {
    label: 'Now',
    className: 'border-brand bg-surface-selected text-primary',
  },
  next: {
    label: 'Next',
    className: 'border-border bg-surface text-secondary',
  },
  waiting: {
    label: 'Waiting',
    className: 'border-border bg-surface text-tertiary',
  },
};

export function DisplayBoard({ entries, title, className }: DisplayBoardProps) {
  const now = entries.find((entry) => entry.state === 'now');
  const next = entries.filter((entry) => entry.state === 'next');
  const waiting = entries.filter((entry) => entry.state === 'waiting');

  return (
    <section aria-labelledby="display-board-title" className={cn('flex flex-col gap-6', className)}>
      <h1 id="display-board-title" className="text-public-heading font-semibold text-primary">
        {title}
      </h1>

      {now ? (
        // The single moving part of a board.
        //
        // Built from `NowServing` rather than from its own markup. The brief asks for
        // one ticket component across the staff board, the portal and this screen,
        // and a component that exists three times in three slightly different forms
        // is how a patient ends up standing in the wrong queue certain they are in
        // the right one.
        <div className="rounded-lg border-2 border-brand bg-surface-selected px-6 py-8">
          <NowServing ticket={now.callNumber} desk={now.desk} size="display" />
        </div>
      ) : null}

      {next.length > 0 ? (
        <div>
          <h2 className="mb-2 text-public-small uppercase tracking-wide text-tertiary">Up next</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {next.map((entry) => (
              <DisplayRow key={entry.callNumber} entry={entry} />
            ))}
          </ul>
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <div>
          <h2 className="mb-2 text-public-small uppercase tracking-wide text-tertiary">Waiting</h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {waiting.map((entry) => (
              <DisplayRow key={entry.callNumber} entry={entry} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function DisplayRow({ entry }: { entry: DisplayBoardEntry }) {
  const style = STATE_STYLE[entry.state];
  return (
    <li
      className={cn(
        'flex items-center justify-between gap-4 rounded-lg border px-4 py-3',
        style.className,
      )}
    >
      {/* The state is in the text, so the board is legible with all colour removed. */}
      <QueueTicket ticket={entry.callNumber} size="md" />
      <span className="flex items-center gap-3">
        <span className="text-public-small">{entry.desk}</span>
        <span className="sr-only">{style.label}</span>
      </span>
    </li>
  );
}
