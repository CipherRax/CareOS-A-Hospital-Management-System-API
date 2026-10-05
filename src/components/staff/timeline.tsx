'use client';

import { cn } from '@/lib/cn';
import { StatusPill, type StatusTone } from '@/components/staff/status-pill';

/**
 * Timeline.
 *
 * Ordered clinical events. Sequence is the entire meaning here — a handover note
 * that arrives before the triage decision reads as a different history — so this
 * is an ordered list with real timestamps, not a stack of cards.
 *
 * Rendered newest-first by default, because the question a clinician opens this
 * to answer is "what happened most recently". `timestamp` is always visible: a
 * relative time alone ("2h ago") becomes ambiguous during a long shift and cannot
 * be quoted in a handover.
 *
 * Each entry is timestamped and authored, so a gap in the record is visible rather
 * than implied.
 */

export interface TimelineEvent {
  id: string;
  /** ISO 8601. Rendered absolutely; relative time is offered alongside it. */
  timestamp: string;
  /** Who recorded it, and in what role. */
  author: string;
  eventType: 'triage' | 'assessment' | 'observation' | 'handover' | 'disposition' | 'note';
  summary: string;
  detail?: string;
  tone?: StatusTone;
  /** Free-text tag such as "escalated". Never a diagnosis. */
  tag?: string;
}

export interface TimelineProps {
  events: readonly TimelineEvent[];
  /** Newest first. Set false for a chronological handover note. */
  newestFirst?: boolean;
  /**
   * IANA zone the timestamps are recorded in, e.g. `Africa/Nairobi`.
   *
   * Without this a clinician reads times in whatever offset the server happens to
   * be in, and two events that are genuinely hours apart can look minutes apart —
   * or the reverse. Passing the facility's zone is what makes the gap between two
   * entries explainable.
   */
  timeZone?: string;
  className?: string;
}

const EVENT_LABEL: Record<TimelineEvent['eventType'], string> = {
  triage: 'Triage',
  assessment: 'Assessment',
  observation: 'Observation',
  handover: 'Handover',
  disposition: 'Disposition',
  note: 'Note',
};

/**
 * Absolute time, always.
 *
 * `hour12: false` so the ordering cannot be misread, and `en-GB` for a numeric
 * date. A locale-formatted timestamp is correct for the reader and wrong for
 * comparison, which is why the ISO value is also available in the markup.
 */
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/**
 * The UTC offset in force at a given instant.
 *
 * Resolved per event rather than once, because the offset moves across a DST
 * boundary and a clock time that shifted under a fixed offset is exactly the bug
 * this exists to prevent. Returns null for an absent or unrecognised zone rather
 * than throwing mid-render.
 */
function offsetAt(date: Date, timeZone: string | undefined): string | null {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? null;
  } catch {
    return null;
  }
}

export function Timeline({ events, newestFirst = true, timeZone, className }: TimelineProps) {
  const ordered = [...events].sort((a, b) =>
    newestFirst
      ? Date.parse(b.timestamp) - Date.parse(a.timestamp)
      : Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  if (ordered.length === 0) {
    return (
      <p
        className={cn(
          'rounded-lg border border-border bg-surface px-4 py-8 text-center text-body text-secondary',
          className,
        )}
      >
        No recorded events.
      </p>
    );
  }

  // Named once, not per row: the zone is a property of the record, and repeating
  // it on every entry would bury the timestamps it exists to explain.
  const [newest] = ordered;
  const zoneLabel =
    timeZone && newest ? (offsetAt(new Date(newest.timestamp), timeZone) ?? timeZone) : null;

  return (
    <div className={className}>
      {zoneLabel ? (
        <p className="mb-3 text-caption text-tertiary">All times shown in {zoneLabel}.</p>
      ) : null}
      <ol className="relative flex flex-col">
        {ordered.map((event, index) => {
          const date = new Date(event.timestamp);
          const offset = offsetAt(date, timeZone);

          return (
            <li key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
              {/* Rail. The connecting line stops at the last marker so there is no
                dangling stroke implying an event that has not happened. */}
              <div aria-hidden="true" className="flex w-4 shrink-0 flex-col items-center">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-brand bg-surface" />
                {index < ordered.length - 1 ? (
                  <span className="mt-1 w-px flex-1 bg-border" />
                ) : null}
              </div>

              <div className="min-w-0 flex-1 border-b border-border pb-5 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* `time` with `dateTime` so the machine-readable value survives
                    localisation and any downstream extraction. */}
                  <time
                    dateTime={event.timestamp}
                    className="font-mono text-meta tabular-nums text-secondary"
                  >
                    {dateFormat.format(date)} {timeFormat.format(date)}
                    {/* The offset is part of the time, not decoration: without it
                      the gap to the next entry cannot be reasoned about. */}
                    {offset ? <span className="text-tertiary"> {offset}</span> : null}
                  </time>
                  <span className="text-caption text-tertiary">{EVENT_LABEL[event.eventType]}</span>
                  {event.tone ? (
                    <StatusPill tone={event.tone} label={event.tag ?? event.eventType} size="sm" />
                  ) : null}
                </div>

                <p className="mt-1 text-body text-primary">{event.summary}</p>
                {event.detail ? (
                  <p className="mt-1 text-meta text-secondary">{event.detail}</p>
                ) : null}
                <p className="mt-1 text-caption text-tertiary">Recorded by {event.author}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
