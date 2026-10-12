'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  useDepartmentList,
  useEncounter,
  usePatientName,
  useTransitionEncounter,
} from '@/lib/data/queries';
import {
  ENCOUNTER_TRANSITIONS,
  type EncounterRow,
  type EncounterStatus,
} from '@/lib/data/encounters';

/**
 * Doctor workspace — one encounter (F4).
 *
 * The detail read and the status transition both answer `{ encounter }` while
 * the export types them as the bare entity (GAP-020), so the body is validated
 * in `src/lib/data/encounters.ts`. The move set mirrors the workflow engine
 * (OPEN → IN_PROGRESS → COMPLETED, COMPLETED locked): a stale tab that offers a
 * move the server no longer allows gets a 409 in place.
 */

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
};

export function EncounterWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('encounters');
  const encounter = useEncounter(id);
  const row = encounter.data?.data;

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/encounters"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-secondary underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('workspace.back')}
      </Link>

      {encounter.isLoading && !row ? (
        <p className="text-meta text-tertiary" role="status">
          {t('workspace.loading')}
        </p>
      ) : encounter.error ? (
        <EmptyState
          title={t('workspace.unavailableTitle')}
          description={t('workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !row ? (
        <EmptyState
          title={t('workspace.notFoundTitle')}
          description={t('workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <EncounterBody row={row} />
      )}
    </div>
  );
}

function EncounterBody({ row }: { row: EncounterRow }) {
  const t = useTranslations('encounters');
  const locale = useLocale();
  const [confirmComplete, setConfirmComplete] = useState(false);

  const patient = usePatientName(row.patientId);
  const departments = useDepartmentList();
  const transition = useTransitionEncounter();

  const departmentName = (id: string) =>
    departments.data?.data.find((department) => department.id === id)?.name ?? id;

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const nextStates = ENCOUNTER_TRANSITIONS[row.status as EncounterStatus] ?? [];
  const alert = transition.isError
    ? transition.error?.code === 'INVALID_WORKFLOW_TRANSITION'
      ? { title: t('workspace.staleTitle'), body: t('workspace.staleBody') }
      : { title: t('workspace.failedTitle'), body: t('workspace.failedBody') }
    : null;

  const run = (next: EncounterStatus) => transition.mutate({ id: row.id, status: next });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">
          {patient.isLoading ? '…' : patient.data?.data ?? t('unknownPatient')}
        </h1>
        <StatusPill
          tone={STATUS_TONE[row.status] ?? 'neutral'}
          label={t(`status.${row.status}`)}
        />
      </header>

      {alert ? (
        <div
          role="alert"
          className="flex flex-col gap-1 border border-status-critical px-4 py-3"
        >
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.details')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('workspace.type')}</dt>
            <dd className="text-primary">{t(`type.${row.type}`)}</dd>
            <dt className="text-tertiary">{t('workspace.department')}</dt>
            <dd className="text-primary">{departmentName(row.departmentId)}</dd>
            <dt className="text-tertiary">{t('workspace.provider')}</dt>
            <dd className="text-primary">{t('workspace.unknownProvider')}</dd>
            <dt className="text-tertiary">{t('workspace.opened')}</dt>
            <dd className="tabular-nums text-primary">{format(row.openedAt) ?? t('workspace.notStarted')}</dd>
            <dt className="text-tertiary">{t('workspace.started')}</dt>
            <dd className="tabular-nums text-primary">
              {format(row.inProgressAt) ?? t('workspace.notStarted')}
            </dd>
            <dt className="text-tertiary">{t('workspace.completed')}</dt>
            <dd className="tabular-nums text-primary">
              {format(row.completedAt) ?? t('workspace.notStarted')}
            </dd>
            <dt className="text-tertiary">{t('workspace.note')}</dt>
            <dd className="text-primary">{row.note ?? t('workspace.noNote')}</dd>
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.actions')}</h2>
          {nextStates.length > 0 ? (
            <div className="flex flex-col items-start gap-2">
              {nextStates.map((next) =>
                next === 'COMPLETED' ? (
                  <Button
                    key={next}
                    variant="secondary"
                    disabled={transition.isPending}
                    onClick={() => setConfirmComplete(true)}
                  >
                    {t('workspace.complete')}
                  </Button>
                ) : (
                  <Button
                    key={next}
                    variant="primary"
                    disabled={transition.isPending}
                    onClick={() => run(next)}
                  >
                    {t('workspace.start')}
                  </Button>
                ),
              )}
            </div>
          ) : (
            <p className="text-meta text-secondary">{t('workspace.locked')}</p>
          )}

          <p className="text-caption text-tertiary">
            {t('workspace.version', { version: row.version })}
          </p>

          <Link
            href={`/patients/${row.patientId}`}
            className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
          >
            {t('workspace.openPatient')}
          </Link>
        </section>
      </div>

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        onConfirm={() => {
          setConfirmComplete(false);
          run('COMPLETED');
        }}
        title={t('workspace.confirmCompleteTitle')}
        description={t('workspace.confirmCompleteBody')}
        confirmLabel={t('workspace.complete')}
        cancelLabel={t('workspace.cancel')}
        pending={transition.isPending}
      />
    </div>
  );
}