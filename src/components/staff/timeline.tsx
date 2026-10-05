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

export function Timeline({ events, newestFirst = true, className }: TimelineProps) {
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

  return (
    <ol className={cn('relative flex flex-col', className)}>
      {ordered.map((event, index) => {
        const date = new Date(event.timestamp);

        return (
          <li key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
            {/* Rail. The connecting line stops at the last marker so there is no
                dangling stroke implying an event that has not happened. */}
            <div aria-hidden="true" className="flex w-4 shrink-0 flex-col items-center">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-brand bg-surface" />
              {index < ordered.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
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
  );
}
