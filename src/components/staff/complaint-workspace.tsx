'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import type { QueryError } from '@/lib/data/queries';
import { useComplaint, useUpdateComplaintStatus, useUsers } from '@/lib/data/queries';
import {
  COMPLAINT_NEXT,
  type ComplaintRow,
  type ComplaintStatus,
} from '@/lib/data/quality';

/**
 * Complaints workspace (brief Phase 10) — one complaint and the linear lifecycle
 * that carries it OPEN→ASSIGNED→INVESTIGATING→RESOLVED→CLOSED.
 *
 * The read and both writes answer `{ complaint }` while the export types the bare
 * `ComplaintResponseDto` (GAP-020), so every body is validated in
 * `src/lib/data/quality.ts`. Two service rules shape the moves: a complaint is
 * assigned only as it enters ASSIGNED (or re-assigned while it sits in ASSIGNED or
 * INVESTIGATING), so the assignee picker appears only on the ASSIGNED move; and a
 * complaint may not close without a resolution on record, so the resolution field
 * is required on the CLOSED move and optional while resolving. The transition graph
 * is the only move offered, and one that races a stale tab resolves to a 409
 * rendered in place.
 *
 * The assignee is named here, unlike the worklist: this screen loads the user
 * directory anyway to offer the picker (docs/limitations.md).
 */

const STATUS_TONE: Record<ComplaintStatus, StatusTone> = {
  OPEN: 'critical',
  ASSIGNED: 'info',
  INVESTIGATING: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

export function ComplaintWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('quality.complaints');
  const complaint = useComplaint(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/quality/complaints"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('workspace.back')}
      </Link>

      {complaint.isLoading && !complaint.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('workspace.loading')}
        </p>
      ) : complaint.error ? (
        <EmptyState
          title={t('workspace.unavailableTitle')}
          description={t('workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !complaint.data ? (
        <EmptyState
          title={t('workspace.notFoundTitle')}
          description={t('workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <ComplaintBody complaint={complaint.data.data} />
      )}
    </div>
  );
}

function ComplaintBody({ complaint }: { complaint: ComplaintRow }) {
  const t = useTranslations('quality.complaints');
  const locale = useLocale();
  const update = useUpdateComplaintStatus();
  const users = useUsers({ limit: 100 });

  const assignees = users.data?.data.rows.filter((user) => user.status === 'ACTIVE') ?? [];
  const nameOf = (userId: string | null): string | null => {
    if (!userId) return null;
    const user = users.data?.data.rows.find((candidate) => candidate.id === userId);
    return user ? `${user.firstName} ${user.lastName}`.trim() : null;
  };

  const [assigneeId, setAssigneeId] = useState('');
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);

  const next = COMPLAINT_NEXT[complaint.status];
  const effectiveResolution = (resolution.trim() || complaint.resolution || '').trim();
  const hasResolution = effectiveResolution.length > 0;

  const alert = update.isError && update.error ? describeFailure(update.error, t) : null;

  const submit = () => {
    setError(null);
    if (!next) return;
    if (next === 'ASSIGNED' && assigneeId === '') {
      setError(t('workspace.errors.assigneeRequired'));
      return;
    }
    if (next === 'CLOSED' && !hasResolution) {
      setError(t('workspace.errors.resolutionRequired'));
      return;
    }
    update.mutate({
      id: complaint.id,
      status: next,
      ...(next === 'ASSIGNED' ? { assignedToId: assigneeId } : {}),
      ...(resolution.trim() ? { resolution: resolution.trim() } : {}),
    });
  };

  const format = (iso: string | null) =>
    iso ? formatUtc(iso, locale) : t('workspace.notRecorded');

  const assigneeName = nameOf(complaint.assignedToId);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">{complaint.category}</h1>
        <StatusPill tone={STATUS_TONE[complaint.status]} label={t(`status.${complaint.status}`)} />
      </header>

      {alert ? (
        <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          aria-labelledby="complaint-summary-heading"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="complaint-summary-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.summaryHeading')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('columnOrigin')}</dt>
            <dd className="text-primary">{t(`origin.${complaint.origin}`)}</dd>
            <dt className="text-tertiary">{t('workspace.assignedTo')}</dt>
            <dd className="text-primary">
              {assigneeName ?? (complaint.assignedToId ? t('assigned') : t('unassigned'))}
            </dd>
            <dt className="text-tertiary">{t('columnDue')}</dt>
            <dd className="tabular-nums text-primary">{format(complaint.dueAt)}</dd>
            <dt className="text-tertiary">{t('columnSubmitted')}</dt>
            <dd className="tabular-nums text-primary">{format(complaint.createdAt)}</dd>
            <dt className="text-tertiary">{t('workspace.closedAt')}</dt>
            <dd className="tabular-nums text-primary">{format(complaint.closedAt)}</dd>
          </dl>
          <p className="text-meta text-secondary">
            <span className="font-medium text-tertiary">{t('workspace.descriptionLabel')}: </span>
            {complaint.description}
          </p>
        </section>

        <section
          aria-labelledby="complaint-resolution-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2
            id="complaint-resolution-heading"
            className="text-subheading font-semibold text-primary"
          >
            {t('workspace.resolutionHeading')}
          </h2>
          {complaint.resolution ? (
            <p className="text-meta text-secondary">{complaint.resolution}</p>
          ) : (
            <p className="text-meta text-tertiary">{t('workspace.noResolution')}</p>
          )}
        </section>

        <section
          aria-labelledby="complaint-action-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="complaint-action-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.actionHeading')}
          </h2>
          {next ? (
            <>
              {next === 'ASSIGNED' ? (
                <Field id="complaint-assignee" label={t('workspace.assigneeLabel')} required>
                  {({ controlId }) => (
                    <Select
                      id={controlId}
                      value={assigneeId}
                      onChange={(event) => {
                        setAssigneeId(event.target.value);
                        if (error) setError(null);
                      }}
                    >
                      <option value="">{t('workspace.chooseAssignee')}</option>
                      {assignees.map((user) => (
                        <option key={user.id} value={user.id}>
                          {`${user.firstName} ${user.lastName}`.trim()}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}

              {next === 'RESOLVED' || next === 'CLOSED' ? (
                <Field
                  id="complaint-resolution"
                  label={t('workspace.resolutionLabel')}
                  hint={t('workspace.resolutionHint')}
                  required={next === 'CLOSED' && !complaint.resolution}
                >
                  {({ controlId, describedBy, invalid }) => (
                    <Textarea
                      id={controlId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      rows={4}
                      maxLength={5000}
                      value={resolution}
                      onChange={(event) => setResolution(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              {error ? (
                <p role="alert" className="text-caption text-status-critical">
                  {error}
                </p>
              ) : null}
              <Button
                variant="primary"
                disabled={update.isPending || (next === 'CLOSED' && !hasResolution)}
                onClick={submit}
              >
                {update.isPending ? t('workspace.submitting') : t(`workspace.action.${next}`)}
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
