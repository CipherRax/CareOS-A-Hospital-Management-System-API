'use client';

import { Siren } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import {
  useEmergencySummary,
  useEmergencyVisits,
  usePatientName,
  usePatientSearch,
  useRegisterEmergencyVisit,
} from '@/lib/data/queries';
import {
  EMERGENCY_PRIORITIES,
  EMERGENCY_STATUSES,
  type EmergencyPriority,
  type EmergencySummaryRow,
  type EmergencyVisitRow,
  type EmergencyVisitStatus,
} from '@/lib/data/emergency';
import type { PatientListItem } from '@/lib/data/patients';

/**
 * Emergency desk (F8 slice 3) — the live ED board, newest arrivals first.
 *
 * `GET /emergency/visits` types its 200 as the request DTO while the service
 * answers a `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/emergency.ts`. Rows carry only `patientId`; names resolve on
 * demand (GAP-018). Today's metrics come from `GET /emergency/summary`.
 *
 * Registering an arrival posts to `POST /emergency/visits`; the app has no branch
 * picker, so the EXAMPLE branch is used (GAP-018).
 */

export const EMERGENCY_STATUS_TONE: Record<EmergencyVisitStatus, StatusTone> = {
  ARRIVED: 'warning',
  TRIAGED: 'info',
  ASSESSED: 'info',
  IN_TREATMENT: 'info',
  OBSERVATION: 'warning',
  DISCHARGED: 'success',
  ADMITTED: 'neutral',
  REFERRED: 'neutral',
};

export const EMERGENCY_PRIORITY_TONE: Record<EmergencyPriority, StatusTone> = {
  RESUSCITATION: 'critical',
  EMERGENT: 'critical',
  URGENT: 'warning',
  SEMI_URGENT: 'info',
  NON_URGENT: 'neutral',
};

export function EmergencyWorklistScreen() {
  const t = useTranslations('emergency');
  const locale = useLocale();
  const [status, setStatus] = useState<EmergencyVisitStatus | ''>('');
  const [priority, setPriority] = useState<EmergencyPriority | ''>('');
  const [registerOpen, setRegisterOpen] = useState(false);

  const visits = useEmergencyVisits({
    status: status || undefined,
    priority: priority || undefined,
  });
  const rows = visits.data?.data.rows ?? [];
  const summary = useEmergencySummary();

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  const columns: readonly DataTableColumn<EmergencyVisitRow>[] = [
    {
      key: 'visit',
      header: t('columnVisit'),
      cell: (row) => (
        <span className="font-medium tabular-nums text-primary">{row.visitNumber}</span>
      ),
    },
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientNameCell id={row.patientId} />,
    },
    {
      key: 'priority',
      header: t('columnPriority'),
      cell: (row) =>
        row.priority ? (
          <StatusPill
            size="sm"
            tone={EMERGENCY_PRIORITY_TONE[row.priority]}
            label={t(`emergencyPriority.${row.priority}`)}
          />
        ) : (
          <span className="text-tertiary">{t('priorityPending')}</span>
        ),
    },
    {
      key: 'arrived',
      header: t('columnArrived'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatTime(row.arrivedAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={EMERGENCY_STATUS_TONE[row.status]}
          label={t(`emergencyStatus.${row.status}`)}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('title')}</h1>
          <p className="text-meta text-secondary">{t('intro')}</p>
        </div>
        <Button variant="primary" onClick={() => setRegisterOpen(true)}>
          {t('registerArrival')}
        </Button>
      </header>

      <SummaryStrip summary={summary.data?.data ?? null} />

      <div className="flex flex-wrap gap-4">
        <div className="w-52">
          <Field id="emergency-status-filter" label={t('filterStatus')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={status}
                onChange={(event) => setStatus(event.target.value as EmergencyVisitStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {EMERGENCY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`emergencyStatus.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-52">
          <Field id="emergency-priority-filter" label={t('filterPriority')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={priority}
                onChange={(event) => setPriority(event.target.value as EmergencyPriority | '')}
              >
                <option value="">{t('allPriorities')}</option>
                {EMERGENCY_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`emergencyPriority.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {visits.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={Siren}
          headingLevel={2}
        />
      ) : (
        <DataTable<EmergencyVisitRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/emergency/${row.id}`}
          rowLinkLabel={(row) => t('openVisit', { number: row.visitNumber })}
          loading={visits.isLoading}
          emptyMessage={t('empty')}
        />
      )}

      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} />
    </div>
  );
}

function SummaryStrip({ summary }: { summary: EmergencySummaryRow | null }) {
  const t = useTranslations('emergency');
  if (!summary) return null;

  const stats: readonly { readonly key: string; readonly label: string; readonly value: string }[] = [
    { key: 'arrivals', label: t('statArrivals'), value: String(summary.arrivals) },
    { key: 'active', label: t('statActive'), value: String(summary.active) },
    {
      key: 'triage',
      label: t('statAvgTriage'),
      value: t('minutesShort', { value: summary.avgMinutesToTriage }),
    },
    {
      key: 'disposition',
      label: t('statAvgDisposition'),
      value: t('minutesShort', { value: summary.avgMinutesToDisposition }),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.key} className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
          <dt className="text-caption text-tertiary">{stat.label}</dt>
          <dd className="text-subheading font-semibold tabular-nums text-primary">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PatientNameCell({ id }: { id: string }) {
  const t = useTranslations('emergency');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}

function RegisterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('emergency');
  const register = useRegisterEmergencyVisit();

  const [query, setQuery] = useState('');
  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = usePatientSearch(query);

  const close = () => {
    setQuery('');
    setPatient(null);
    setError(null);
    register.reset();
    onOpenChange(false);
  };

  const submit = () => {
    if (!patient) {
      setError(t('patientRequired'));
      return;
    }
    register.mutate({ patientId: patient.id }, { onSuccess: () => close() });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('registerTitle')} description={t('registerBody')} />
        <DialogBody className="flex flex-col gap-4">
          {patient ? (
            <div className="flex items-center justify-between gap-3 border border-border px-3 py-2">
              <span className="text-body text-primary">{patient.displayName}</span>
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => {
                  setPatient(null);
                  setQuery('');
                }}
              >
                {t('changePatient')}
              </Button>
            </div>
          ) : (
            <>
              <Field id="register-patient-search" label={t('patientSearch')} required>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    value={query}
                    placeholder={t('patientSearchPlaceholder')}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                )}
              </Field>
              {query.trim() ? (
                search.isLoading ? (
                  <p role="status" className="text-meta text-tertiary">
                    {t('searching')}
                  </p>
                ) : (search.data?.data.items.length ?? 0) === 0 ? (
                  <p className="text-meta text-secondary">{t('noPatients')}</p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto border border-border">
                    {search.data?.data.items.map((item) => (
                      <li key={item.id} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            setPatient(item);
                            if (error) setError(null);
                          }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-hover"
                        >
                          <span className="text-body text-primary">{item.displayName}</span>
                          <span className="text-caption tabular-nums text-tertiary">
                            {item.patientNumber}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}

          {error ? (
            <p role="alert" className="text-caption text-status-critical">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={register.isPending} onClick={submit}>
            {t('submitRegister')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
