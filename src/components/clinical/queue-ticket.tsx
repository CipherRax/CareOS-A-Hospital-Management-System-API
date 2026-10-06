import { cn } from '@/lib/cn';

/**
 * Queue ticket and now-serving display.
 *
 * Brief §2.4: "large mono ticket numbers (e.g. A034), used in staff boards, patient
 * portal, and the waiting-room display". One component for all three, because a
 * ticket number that renders differently in the waiting room than in the portal is
 * how a patient ends up standing in the wrong queue convinced they were in the
 * right one.
 *
 * The number is **mono with tabular figures**. Ticket numbers are read aloud, copied
 * into notes, and compared digit by digit; a proportional `1` and `7` in the same
 * string is a real hazard at a counter.
 *
 * `NowServing` owns a polite live region. A portal tab open on a phone is going to
 * be checked every thirty seconds, and a person waiting cannot see the screen
 * change. Announcing it means someone using a screen reader learns they have been
 * called without having to keep refreshing. `polite`, never `assertive`: being called
 * is not an emergency, and interrupting whatever the person is doing is how a board
 * gets muted.
 *
 * No colour is used to carry the ticket's meaning. The label says "Now serving" and
 * that is the whole signal.
 */

export type QueueTicketSize = 'sm' | 'md' | 'lg' | 'display';

const SIZE: Record<QueueTicketSize, string> = {
  // `sm` is the staff queue table; `display` is the waiting-room board at 2–5 m.
  sm: 'text-heading-xs',
  md: 'text-heading',
  lg: 'text-heading-lg',
  display: 'text-public-display',
};

export interface QueueTicketProps {
  /** The queue reference exactly as issued, e.g. "A034". */
  ticket: string;
  /** What the number is. Optional only where the surrounding context is unambiguous. */
  label?: string;
  size?: QueueTicketSize;
  className?: string;
}

export function QueueTicket({ ticket, label, size = 'md', className }: QueueTicketProps) {
  return (
    <span className={cn('inline-flex flex-col gap-0.5', className)}>
      {label ? (
        <span className="text-caption uppercase tracking-wide text-tertiary">{label}</span>
      ) : null}
      <span className={cn('font-mono font-semibold tabular-nums text-primary', SIZE[size])}>
        {ticket}
      </span>
    </span>
  );
}

export interface NowServingProps {
  ticket: string;
  /** Desk, clinician or room, as displayed. */
  desk?: string;
  /** Overrides the default "Now serving". */
  label?: string;
  size?: QueueTicketSize;
  className?: string;
}

export function NowServing({
  ticket,
  desk,
  label = 'Now serving',
  size = 'lg',
  className,
}: NowServingProps) {
  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <p className="text-caption uppercase tracking-wide text-tertiary">{label}</p>
      {/*
        The live region wraps the number so the announcement is the call itself,
        rather than the label plus the number plus whatever the container later
        holds. `aria-atomic` so a change is read once and whole rather than
        character by character.

        An ordinary `div`, deliberately: `display: contents` would have removed this
        element's own box, and engines have historically dropped `display: contents`
        elements from the accessibility tree along with it. A live region that
        sometimes cannot be announced is worse than no live region.
      */}
      <div aria-live="polite" aria-atomic="true">
        <QueueTicket ticket={ticket} size={size} />
      </div>
      {desk ? <p className="text-body text-secondary">{desk}</p> : null}
    </div>
  );
}
