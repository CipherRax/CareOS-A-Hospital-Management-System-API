'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import type { QueryError } from '@/lib/data/queries';
import { useFeedback, useRespondToFeedback } from '@/lib/data/queries';
import { FEEDBACK_NEXT, type FeedbackRow, type FeedbackStatus } from '@/lib/data/quality';

/**
 * Feedback workspace (brief Phase 10) — one feedback record and the single write
 * it has: a response, which advances it NEW→ACKNOWLEDGED→RESOLVED→CLOSED.
 *
 * The read answers `{ feedback }` while the export types the bare
 * `FeedbackResponseDto`, and the write answers the same shape (GAP-020), so every
 * body is validated in `src/lib/data/quality.ts`. The one business rule that
 * matters here is the service's: feedback may not leave NEW without a response,
 * so the response is required when none is recorded yet and optional afterwards
 * (a re-stated status keeps the stored text). The server's transition graph is
 * the only move offered, and one that races a stale tab resolves to a 409
 * rendered in place.
 */

const STATUS_TONE: Record<FeedbackStatus, StatusTone> = {
  NEW: 'info',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

export function FeedbackWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('quality.feedback');
  const feedback = useFeedback(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/quality/feedback"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('workspace.back')}
      </Link>

      {feedback.isLoading && !feedback.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('workspace.loading')}
        </p>
      ) : feedback.error ? (
        <EmptyState
          title={t('workspace.unavailableTitle')}
          description={t('workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !feedback.data ? (
        <EmptyState
          title={t('workspace.notFoundTitle')}
          description={t('workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <FeedbackBody feedback={feedback.data.data} />
      )}
    </div>
  );
}

function FeedbackBody({ feedback }: { feedback: FeedbackRow }) {
  const t = useTranslations('quality.feedback');
  const locale = useLocale();
  const respond = useRespondToFeedback();

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const next = FEEDBACK_NEXT[feedback.status];
  const effectiveResponse = (draft.trim() || feedback.response || '').trim();
  const hasResponse = effectiveResponse.length > 0;

  const alert =
    respond.isError && respond.error ? describeFailure(respond.error, t) : null;

  const submit = () => {
    setError(null);
    if (!next) return;
    if (!hasResponse) {
      setError(t('workspace.errors.respondRequired'));
      return;
    }
    respond.mutate({
      id: feedback.id,
      status: next,
      ...(draft.trim() ? { response: draft.trim() } : {}),
    });
  };

  const format = (iso: string | null) =>
    iso ? formatUtc(iso, locale) : t('workspace.notRecorded');

  const submittedBy = feedback.patientId
    ? t('workspace.submittedByPatient')
    : feedback.submittedById
      ? t('workspace.submittedByStaff')
      : t('workspace.notRecorded');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">
          {t('workspace.heading', { category: t(`category.${feedback.category}`) })}
        </h1>
        <StatusPill tone={STATUS_TONE[feedback.status]} label={t(`status.${feedback.status}`)} />
      </header>

      {alert ? (
        <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          aria-labelledby="feedback-summary-heading"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="feedback-summary-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.summaryHeading')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('columnRating')}</dt>
            <dd className="tabular-nums text-primary">
              {t('ratingValue', { rating: feedback.rating })}
            </dd>
            <dt className="text-tertiary">{t('workspace.submittedBy')}</dt>
            <dd className="text-primary">{submittedBy}</dd>
            <dt className="text-tertiary">{t('columnSubmitted')}</dt>
            <dd className="tabular-nums text-primary">{format(feedback.createdAt)}</dd>
            <dt className="text-tertiary">{t('workspace.handled')}</dt>
            <dd className="tabular-nums text-primary">{format(feedback.handledAt)}</dd>
          </dl>
          <p className="text-meta text-secondary">
            <span className="font-medium text-tertiary">{t('columnComment')}: </span>
            {feedback.comment ?? t('noComment')}
          </p>
        </section>

        <section
          aria-labelledby="feedback-response-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="feedback-response-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.responseHeading')}
          </h2>
          {feedback.response ? (
            <p className="text-meta text-secondary">{feedback.response}</p>
          ) : (
            <p className="text-meta text-tertiary">{t('workspace.noResponse')}</p>
          )}
        </section>

        <section
          aria-labelledby="feedback-respond-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="feedback-respond-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.respondHeading')}
          </h2>
          {next ? (
            <>
              <Field
                id="feedback-response"
                label={t('workspace.respondLabel')}
                hint={t('workspace.respondHint')}
                required={!feedback.response}
              >
                {({ controlId, describedBy, invalid }) => (
                  <Textarea
                    id={controlId}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    rows={4}
                    maxLength={5000}
                    placeholder={t('workspace.respondPlaceholder')}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                )}
              </Field>
              {error ? (
                <p role="alert" className="text-caption text-status-critical">
                  {error}
                </p>
              ) : null}
              <Button variant="primary" disabled={respond.isPending || !hasResponse} onClick={submit}>
                {respond.isPending ? t('workspace.submitting') : t(`workspace.action.${next}`)}
              </Button>
            </>
          ) : (
            <p className="text-meta text-secondary">{t('workspace.noActions')}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Renders a 409 from a stale tab as "reload", a rejected rule as itself. */
function describeFailure(error: QueryError, t: (key: string) => string) {
  if (error.code === 'INVALID_WORKFLOW_TRANSITION') {
    return {
      title: t('workspace.errors.staleTitle'),
      body: t('workspace.errors.staleBody'),
    };
  }
  if (error.code === 'VALIDATION_ERROR') {
    return {
      title: t('workspace.errors.invalidTitle'),
      body: t('workspace.errors.invalidBody'),
    };
  }
  return {
    title: t('workspace.errors.failedTitle'),
    body: t('workspace.errors.failedBody'),
  };
}

/** Formats an ISO instant as a UTC instant — stable between server and client. */
function formatUtc(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}
