'use client';

import { useTranslations } from 'next-intl';
import { Ticket, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { QueueTicket } from '@/components/clinical/queue-ticket';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useDepartmentList,
  usePatientSearch,
  useQueue,
  useQueueMetrics,
  useRegisterWalkIn,
  useUpdateQueuePriority,
  useUpdateQueueStatus,
} from '@/lib/data/queries';
import {
  ACTIVE_QUEUE_STATUSES,
  QUEUE_TRANSITIONS,
  boardOrder,
  waitingMinutes,
  type OperationalPriority,
  type QueueEntryRow,
  type QueueStatus,
} from '@/lib/data/queue';
import { cn } from '@/lib/cn';

/**
 * Reception — queue board (F3).
 *
 * The board is `GET /queue` with a department/status filter. Its 200 is
 * mis-typed as the request DTO in the export (GAP-017), so the rows are validated
 * structurally in `src/lib/data/queue.ts`.
 *
 * The actions offered per row are drawn from the API's own transition graph
 * (`QUEUE_TRANSITIONS`), so an illegal move is not presented and then refused.
 * The server still enforces it — a stale tab is the whole reason this is a rule,
 * not a convenience.
 *
 * The walk-in panel is the same queue entry point as F2's registration: find the
 * patient, pick a department, and take a ticket. A patient with an open visit is
 * refused with `VISIT_ALREADY_ACTIVE`, which the panel shows in place rather than
 * as a generic failure.
 */

const STATUS_TONE: Record<string, 'critical' | 'warning' | 'info' | 'success' | 'neutral'> = {
  WAITING: 'info',
  CALLED: 'warning',
  IN_SERVICE: 'success',
  COMPLETED: 'success',
  NO_SHOW: 'warning',
  ABANDONED: 'neutral',
  CANCELLED: 'neutral',
  TRANSFERRED: 'neutral',
};

const PRIORITY_TONE: Record<string, 'critical' | 'warning' | 'info' | 'neutral'> = {
  URGENT: 'critical',
  HIGH: 'warning',
  NORMAL: 'info',
  LOW: 'neutral',
};

/** Forward moves the board offers. ABANDONED and TRANSFERRED stay graph-only. */
const ACTION_FOR_STATUS: Record<string, string> = {
  CALLED: 'call',
  IN_SERVICE: 'start',
  COMPLETED: 'complete',
  WAITING: 'returnToWaiting',
  NO_SHOW: 'noShow',
  CANCELLED: 'cancel',
};

export function QueueBoardScreen() {
  const t = useTranslations('queue');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [actionError, setActionError] = useState<{ title: string; body: string } | null>(null);

  const departments = useDepartmentList();
  const queue = useQueue({ departmentId: departmentId || undefined, status: status || undefined });
  const metrics = useQueueMetrics();
  const move = useUpdateQueueStatus();
  const reprioritise = useUpdateQueuePriority();

  const departmentName = (id: string) =>
    departments.data?.data.find((department) => department.id === id)?.name ?? id;

  const rows = boardOrder(queue.data?.data.items ?? []);

  function applyStatus(entry: QueueEntryRow, next: QueueStatus) {
    setActionError(null);
    move.mutate(
      { id: entry.id, status: next },
      {
        onError: (error) => {
          setActionError({
            title: error.resolved?.titleKey ?? 'error.internal.title',
            body:
              error.code === 'INVALID_WORKFLOW_TRANSITION'
                ? t('staleMove')
                : (error.resolved?.messageKey ?? 'error.internal.body'),
          });
        },
      },
    );
  }

  function applyPriority(entry: QueueEntryRow, priority: OperationalPriority) {
    setActionError(null);
    reprioritise.mutate(
      { id: entry.id, operationalPriority: priority },
      {
        onError: (error) => {
          setActionError({
            title: error.resolved?.titleKey ?? 'error.internal.title',
            body: error.resolved?.messageKey ?? 'error.internal.body',
          });
        },
      },
    );
  }

  const columns: readonly DataTableColumn<QueueEntryRow>[] = [
    {
      key: 'ticket',
      header: t('columnTicket'),
      width: '6rem',
      cell: (row) => <QueueTicket ticket={row.ticketNumber} size="sm" />,
    },
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => row.patient ?? t('unknownPatient'),
    },
    {
      key: 'department',
      header: t('columnDepartment'),
      cell: (row) => <span className="text-secondary">{departmentName(row.departmentId)}</span>,
    },
    {
      key: 'priority',
      header: t('columnPriority'),
      width: '9rem',
      cell: (row) =>
        ACTIVE_QUEUE_STATUSES.has(row.status) ? (
          <Select
            value={row.operationalPriority}
            aria-label={t('priorityFor', { ticket: row.ticketNumber })}
            disabled={reprioritise.isPending}
            onChange={(event) => applyPriority(row, event.target.value as OperationalPriority)}
          >
            {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill
            tone={PRIORITY_TONE[row.operationalPriority] ?? 'neutral'}
            size="sm"
            label={t(`priority.${row.operationalPriority}`)}
          />
        ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      width: '9rem',
      cell: (row) => (
        <StatusPill
          tone={STATUS_TONE[row.status] ?? 'neutral'}
          size="sm"
          label={t(`status.${row.status}`)}
        />
      ),
    },
    {
      key: 'waited',
      header: t('columnWaited'),
      width: '8rem',
      numeric: true,
      cell: (row) => {
        const minutes = ACTIVE_QUEUE_STATUSES.has(row.status) ? waitingMinutes(row) : null;
        return (
          <span className="tabular-nums text-secondary">
            {minutes === null ? '—' : t('waitedMinutes', { minutes })}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: t('columnActions'),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {(QUEUE_TRANSITIONS[row.status] ?? [])
            .filter((next) => ACTION_FOR_STATUS[next])
            .map((next) => (
              <Button
                key={next}
                size="sm"
                variant="secondary"
                disabled={move.isPending}
                onClick={() => applyStatus(row, next)}
              >
                {t(`action.${ACTION_FOR_STATUS[next]}`)}
              </Button>
            ))}
          {(QUEUE_TRANSITIONS[row.status] ?? []).filter((next) => ACTION_FOR_STATUS[next]).length ===
          0 ? (
            <span className="text-meta text-tertiary">—</span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
          <p className="text-meta text-secondary">{t('pageIntro')}</p>
        </div>
      </header>

      <QueueMetrics
        waiting={metrics.data?.data.currentlyWaiting ?? null}
        avgCallWait={metrics.data?.data.avgCallWaitMinutes ?? null}
        avgService={metrics.data?.data.avgServiceMinutes ?? null}
        abandonment={metrics.data?.data.abandonmentRate ?? null}
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-xs">
          <Field id="queue-department" label={t('filterDepartment')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t('allDepartments')}</option>
                {(departments.data?.data ?? [])
                  .filter((department) => department.active)
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-full max-w-xs">
          <Field id="queue-status" label={t('filterStatus')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t('allStatuses')}</option>
                {(
                  [
                    'WAITING',
                    'CALLED',
                    'IN_SERVICE',
                    'COMPLETED',
                    'NO_SHOW',
                    'ABANDONED',
                    'CANCELLED',
                    'TRANSFERRED',
                  ] as const
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {actionError ? <QueueAlert title={actionError.title} body={actionError.body} /> : null}

      {queue.error ? (
        <QueueAlert title={t('unavailableTitle')} body={t('unavailableBody')} />
      ) : (
        <DataTable
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={queue.isLoading}
          emptyMessage={t('empty')}
        />
      )}

      <WalkInPanel departments={departments.data?.data ?? []} />
    </div>
  );
}

function QueueMetrics({
  waiting,
  avgCallWait,
  avgService,
  abandonment,
}: {
  waiting: number | null;
  avgCallWait: number | null;
  avgService: number | null;
  abandonment: number | null;
}) {
  const t = useTranslations('queue');
  const items = [
    { key: 'waiting', label: t('metricWaiting'), value: waiting === null ? '—' : String(waiting) },
    {
      key: 'callWait',
      label: t('metricCallWait'),
      value: avgCallWait === null ? '—' : t('waitedMinutes', { minutes: avgCallWait }),
    },
    {
      key: 'service',
      label: t('metricService'),
      value: avgService === null ? '—' : t('waitedMinutes', { minutes: avgService }),
    },
    {
      key: 'abandonment',
      label: t('metricAbandonment'),
      value: abandonment === null ? '—' : `${Math.round(abandonment * 100)}%`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 border border-border bg-surface px-4 py-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-0.5">
          <dt className="text-caption uppercase tracking-wide text-tertiary">{item.label}</dt>
          <dd className="text-heading-xs font-semibold tabular-nums text-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WalkInPanel({
  departments,
}: {
  departments: readonly { id: string; name: string; active: boolean }[];
}) {
  const t = useTranslations('queue.walkIn');
  const queueT = useTranslations('queue');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [patientId, setPatientId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [priority, setPriority] = useState<OperationalPriority>('NORMAL');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<{ ticketNumber: string; position: number | null } | null>(
    null,
  );
  const [error, setError] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const search = usePatientSearch(debounced);
  const register = useRegisterWalkIn();

  const results = search.data?.data.items ?? [];
  const selectedPatient = results.find((patient) => patient.id === patientId) ?? null;

  function submit() {
    setError(null);
    if (!patientId || !departmentId) {
      setError({ title: t('missingTitle'), body: t('missingBody') });
      return;
    }
    register.mutate(
      {
        patientId,
        departmentId,
        source: 'WALK_IN',
        priority,
        note: note.trim() || null,
      },
      {
        onSuccess: (data) => {
          setReceipt({ ticketNumber: data.ticketNumber, position: data.position });
        },
        onError: (registerError) => {
          setError({
            title:
              registerError.code === 'VISIT_ALREADY_ACTIVE'
                ? t('alreadyActiveTitle')
                : (registerError.resolved?.titleKey ?? 'error.internal.title'),
            body:
              registerError.code === 'VISIT_ALREADY_ACTIVE'
                ? t('alreadyActiveBody')
                : (registerError.resolved?.messageKey ?? 'error.internal.body'),
          });
        },
      },
    );
  }

  function reset() {
    setQuery('');
    setDebounced('');
    setPatientId('');
    setDepartmentId('');
    setPriority('NORMAL');
    setNote('');
    setReceipt(null);
    setError(null);
  }

  if (receipt) {
    return (
      <section aria-labelledby="walkin-title" className="flex flex-col gap-3">
        <h2 id="walkin-title" className="text-heading-xs font-semibold text-primary">
          {t('title')}
        </h2>
        <EmptyState
          headingLevel={3}
          icon={Ticket}
          title={t('ticketed')}
          description={
            receipt.position === null
              ? t('ticketedBody', { ticket: receipt.ticketNumber })
              : t('ticketedBodyPosition', {
                  ticket: receipt.ticketNumber,
                  position: receipt.position,
                })
          }
          action={
            <Button variant="secondary" onClick={reset}>
              {t('registerAnother')}
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="walkin-title" className="flex flex-col gap-3">
      <div>
        <h2 id="walkin-title" className="text-heading-xs font-semibold text-primary">
          {t('title')}
        </h2>
        <p className="text-meta text-secondary">{t('intro')}</p>
      </div>

      {error ? <QueueAlert title={error.title} body={error.body} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field id="walkin-search" label={t('searchLabel')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                type="search"
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPatientId('');
                }}
                placeholder={t('searchPlaceholder')}
              />
            )}
          </Field>

          <p role="status" aria-live="polite" className="text-meta text-tertiary">
            {search.isFetching
              ? t('searching')
              : debounced.trim() && results.length > 0
                ? t('resultsCount', { count: results.length })
                : ''}
          </p>

          {results.length > 0 ? (
            <ul aria-label={t('searchResults')} className="flex flex-col divide-y divide-border border border-border">
              {results.map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    aria-pressed={patientId === patient.id}
                    onClick={() => setPatientId(patient.id)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left',
                      patientId === patient.id ? 'bg-surface-hover' : 'bg-surface hover:bg-surface-hover',
                    )}
                  >
                    <span className="text-body text-primary">{patient.displayName}</span>
                    <span className="font-mono text-caption text-tertiary">
                      {patient.patientNumber}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {debounced.trim() && !search.isFetching && results.length === 0 ? (
            <p className="text-meta text-secondary">{t('noResults')}</p>
          ) : null}
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="text-meta text-secondary">
            {selectedPatient
              ? t('selected', { name: selectedPatient.displayName })
              : t('selectPrompt')}
          </div>

          <Field id="walkin-department" label={t('department')} required>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t('chooseDepartment')}</option>
                {departments
                  .filter((department) => department.active)
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field id="walkin-priority" label={t('priority')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={priority}
                onChange={(event) => setPriority(event.target.value as OperationalPriority)}
              >
                {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((value) => (
                  <option key={value} value={value}>
                    {queueT(`priority.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="walkin-note" label={t('note')} hint={t('noteHint')}>
            {({ controlId, describedBy }) => (
              <Textarea
                id={controlId}
                aria-describedby={describedBy}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>

          <div>
            <Button type="submit" disabled={register.isPending || !patientId || !departmentId}>
              {register.isPending ? (
                t('submitting')
              ) : (
                <>
                  <UserPlus aria-hidden className="size-4" strokeWidth={1.5} />
                  {t('submit')}
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function QueueAlert({ title, body }: { title: string; body: string }) {
  const err = useTranslations('error');
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 border border-status-critical bg-status-critical-bg px-4 py-3"
    >
      <h2 className="text-body font-semibold text-status-critical">{err(title)}</h2>
      <p className="text-meta text-secondary">{err(body)}</p>
    </div>
  );
}
