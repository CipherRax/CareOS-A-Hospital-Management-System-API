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
import { useIncident, useUpdateIncidentStatus } from '@/lib/data/queries';
import {
  INCIDENT_NEXT,
  type IncidentRow,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/data/quality';

/**
 * Incidents workspace (brief Phase 10) — one incident and the linear lifecycle
 * that carries it OPEN→INVESTIGATING→ACTION_PLAN→RESOLVED→CLOSED.
 *
 * The read and both writes answer `{ incident }` while the export types the bare
 * `IncidentResponseDto` (GAP-020), so every body is validated in
 * `src/lib/data/quality.ts`. The service enforces no rule beyond the transition
 * graph, so this screen adds none: the actions-taken field appears on the
 * ACTION_PLAN move (where that record belongs) and the resolution on the RESOLVED
 * move, both optional, and closure needs neither. The transition graph is the only
 * move offered, and one that races a stale tab resolves to a 409 rendered in place.
 */

const STATUS_TONE: Record<IncidentStatus, StatusTone> = {
  OPEN: 'critical',
  INVESTIGATING: 'warning',
  ACTION_PLAN: 'info',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

const SEVERITY_TONE: Record<IncidentSeverity, StatusTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'critical',
};

export function IncidentWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('quality.incidents');
  const incident = useIncident(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/quality/incidents"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('workspace.back')}
      </Link>

      {incident.isLoading && !incident.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('workspace.loading')}
        </p>
      ) : incident.error ? (
        <EmptyState
          title={t('workspace.unavailableTitle')}
          description={t('workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !incident.data ? (
        <EmptyState
          title={t('workspace.notFoundTitle')}
          description={t('workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <IncidentBody incident={incident.data.data} />
      )}
    </div>
  );
}

function IncidentBody({ incident }: { incident: IncidentRow }) {
  const t = useTranslations('quality.incidents');
  const locale = useLocale();
  const update = useUpdateIncidentStatus();

  const [actionsTaken, setActionsTaken] = useState('');
  const [resolution, setResolution] = useState('');

  const next = INCIDENT_NEXT[incident.status];

  const alert = update.isError && update.error ? describeFailure(update.error, t) : null;

  const submit = () => {
    if (!next) return;
    update.mutate({
      id: incident.id,
      status: next,
      ...(actionsTaken.trim() ? { actionsTaken: actionsTaken.trim() } : {}),
      ...(resolution.trim() ? { resolution: resolution.trim() } : {}),
    });
  };

  const format = (iso: string | null) =>
    iso ? formatUtc(iso, locale) : t('workspace.notRecorded');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">{t(`category.${incident.category}`)}</h1>
        <StatusPill tone={STATUS_TONE[incident.status]} label={t(`status.${incident.status}`)} />
        <StatusPill
          tone={SEVERITY_TONE[incident.severity]}
          label={t(`severity.${incident.severity}`)}
        />
      </header>

      {alert ? (
        <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          aria-labelledby="incident-summary-heading"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="incident-summary-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.summaryHeading')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('columnCategory')}</dt>
            <dd className="text-primary">{t(`category.${incident.category}`)}</dd>
            <dt className="text-tertiary">{t('columnSeverity')}</dt>
            <dd className="text-primary">{t(`severity.${incident.severity}`)}</dd>
            <dt className="text-tertiary">{t('columnReported')}</dt>
            <dd className="tabular-nums text-primary">{format(incident.createdAt)}</dd>
            <dt className="text-tertiary">{t('workspace.resolvedAt')}</dt>
            <dd className="tabular-nums text-primary">{format(incident.resolvedAt)}</dd>
            <dt className="text-tertiary">{t('workspace.closedAt')}</dt>
            <dd className="tabular-nums text-primary">{format(incident.closedAt)}</dd>
          </dl>
          <p className="text-meta text-secondary">
            <span className="font-medium text-tertiary">{t('workspace.descriptionLabel')}: </span>
            {incident.description}
          </p>
        </section>

        <section
          aria-labelledby="incident-actions-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="incident-actions-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.actionsHeading')}
          </h2>
          {incident.actionsTaken ? (
            <p className="text-meta text-secondary">{incident.actionsTaken}</p>
          ) : (
            <p className="text-meta text-tertiary">{t('workspace.noActions')}</p>
          )}
        </section>

        <section
          aria-labelledby="incident-action-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="incident-action-heading" className="text-subheading font-semibold text-primary">
            {t('workspace.actionHeading')}
          </h2>
          {incident.resolution ? (
            <p className="text-meta text-secondary">
              <span className="font-medium text-tertiary">{t('workspace.resolutionLabel')}: </span>
              {incident.resolution}
            </p>
          ) : null}
          {next ? (
            <>
              {next === 'ACTION_PLAN' ? (
                <Field
                  id="incident-actions-taken"
                  label={t('workspace.actionsLabel')}
                  hint={t('workspace.actionsHint')}
                >
                  {({ controlId, describedBy, invalid }) => (
                    <Textarea
                      id={controlId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      rows={4}
                      maxLength={5000}
                      value={actionsTaken}
                      onChange={(event) => setActionsTaken(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              {next === 'RESOLVED' ? (
                <Field
                  id="incident-resolution"
                  label={t('workspace.resolutionLabel')}
                  hint={t('workspace.resolutionHint')}
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

              <Button variant="primary" disabled={update.isPending} onClick={submit}>
                {update.isPending ? t('workspace.submitting') : t(`workspace.move.${next}`)}
              </Button>
            </>
          ) : (
            <p className="text-meta text-secondary">{t('workspace.noMoves')}</p>
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
