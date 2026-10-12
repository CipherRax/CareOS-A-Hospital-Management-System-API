'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CalendarPlus, Clock, ListPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useAcceptWaitlistOffer,
  useAppointments,
  useBookAppointment,
  useCancelAppointment,
  useDeclineWaitlistOffer,
  useDepartmentList,
  useJoinWaitlist,
  useLeaveWaitlist,
  usePatientName,
  usePatientSearch,
  useProviderDirectory,
  useRescheduleAppointment,
  useSlots,
  useUpdateAppointmentStatus,
  useWaitlist,
} from '@/lib/data/queries';
import {
  ACTIONABLE_WAITLIST_STATUSES,
  APPOINTMENT_MODES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  SCHEDULING_BRANCH_ID,
  TERMINAL_APPOINTMENT_STATUSES,
  byStartTime,
  todayISO,
  type AppointmentRow,
  type AppointmentMode,
  type ProviderOption,
  type WaitlistEntryRow,
} from '@/lib/data/scheduling';
import { cn } from '@/lib/cn';

/**
 * Reception — appointment desk (F3).
 *
 * The day book is `GET /appointments` with a department/status/day filter. Its 200
 * is mis-typed as the request DTO in the export (GAP-017), so rows are validated
 * structurally in `src/lib/data/scheduling.ts`.
 *
 * Two contract gaps shape this screen and are worth naming:
 *
 *  - Rows carry only `patientId`/`providerId`; the list is not joined to the
 *    registry (GAP-018). Patient names are therefore resolved per row through
 *    `usePatientName` (cached and deduped by React Query), and provider names come
 *    from the directory already loaded for booking. A real day book would ship both
 *    names with the row.
 *  - No endpoint exposes the caller's branch, yet booking and slot search require
 *    one (GAP-018). The desk is single-branch and posts `SCHEDULING_BRANCH_ID`,
 *    matching the queue board's constant.
 *
 * The actions offered per row are drawn from the API's own transition graph
 * (`APPOINTMENT_TRANSITIONS`), so an illegal move is not presented and then refused.
 * The server still enforces it — a stale tab is the whole reason this is a rule.
 */

const STATUS_TONE: Record<string, 'critical' | 'warning' | 'info' | 'success' | 'neutral'> = {
  BOOKED: 'info',
  CONFIRMED: 'info',
  CHECKED_IN: 'warning',
  IN_PROGRESS: 'success',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'warning',
  RESCHEDULED: 'neutral',
};

const MODE_TONE: Record<string, 'info' | 'neutral'> = {
  IN_PERSON: 'neutral',
  VIRTUAL: 'info',
};

/** Actions the desk exposes. CANCELLED routes through the dedicated cancel call. */
const ACTION_LABEL: Record<string, string> = {
  CONFIRMED: 'action.CONFIRMED',
  CHECKED_IN: 'action.CHECKED_IN',
  IN_PROGRESS: 'action.IN_PROGRESS',
  COMPLETED: 'action.COMPLETED',
  NO_SHOW: 'action.NO_SHOW',
  CANCELLED: 'action.CANCELLED',
};

export function AppointmentDeskScreen() {
  const t = useTranslations('appointments');
  const locale = useLocale();
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [date, setDate] = useState(() => todayISO());
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentRow | null>(null);

  const departments = useDepartmentList();
  const appointments = useAppointments({
    departmentId: departmentId || undefined,
    status: status || undefined,
    date,
  });
  const directory = useProviderDirectory();
  const move = useUpdateAppointmentStatus();
  const cancel = useCancelAppointment();

  const providerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of directory.data?.data ?? []) map.set(provider.id, provider.name);
    return map;
  }, [directory.data]);

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
      new Date(iso),
    );

  const rows = byStartTime(appointments.data?.data.items ?? []);

  function applyStatus(appointment: AppointmentRow, next: string) {
    setActionError(null);
    if (next === 'CANCELLED') {
      setCancelTarget(appointment);
      setCancelReason('');
      return;
    }
    move.mutate(
      { id: appointment.id, status: next as never, reason: undefined },
      {
        onError: (error) => {
          setActionError(
            error.code === 'INVALID_WORKFLOW_TRANSITION' ? t('staleMove') : t('actionFailed'),
          );
        },
      },
    );
  }

  function confirmCancel() {
    if (!cancelTarget) return;
    cancel.mutate(
      {
        id: cancelTarget.id,
        version: cancelTarget.version,
        ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
      },
      {
        onSuccess: () => {
          setCancelTarget(null);
          setCancelReason('');
        },
        onError: () => setActionError(t('actionFailed')),
      },
    );
  }

  const columns: readonly DataTableColumn<AppointmentRow>[] = [
    {
      key: 'time',
      header: t('columnTime'),
      width: '7rem',
      cell: (row) => <span className="tabular-nums text-primary">{formatTime(row.startsAt)}</span>,
    },
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientName id={row.patientId} />,
    },
    {
      key: 'provider',
      header: t('columnProvider'),
      cell: (row) => (
        <span className="text-secondary">{providerName.get(row.providerId) ?? t('unknownProvider')}</span>
      ),
    },
    {
      key: 'mode',
      header: t('columnMode'),
      width: '8rem',
      cell: (row) => (
        <StatusPill tone={MODE_TONE[row.mode] ?? 'neutral'} size="sm" label={t(`mode.${row.mode}`)} />
      ),
    },
    {
      key: 'type',
      header: t('columnType'),
      cell: (row) => <span className="text-secondary">{row.appointmentType ?? '—'}</span>,
    },
    {
      key: 'status',
      header: t('columnStatus'),
      width: '9rem',
      cell: (row) => (
        <StatusPill tone={STATUS_TONE[row.status] ?? 'neutral'} size="sm" label={t(`status.${row.status}`)} />
      ),
    },
    {
      key: 'reason',
      header: t('columnReason'),
      cell: (row) => <span className="text-secondary">{row.reason ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: t('columnActions'),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {(APPOINTMENT_TRANSITIONS[row.status] ?? []).map((next) => (
            <Button
              key={next}
              size="sm"
              variant="secondary"
              disabled={move.isPending || cancel.isPending}
              onClick={() => applyStatus(row, next)}
            >
              {t(ACTION_LABEL[next] ?? `action.${next}`)}
            </Button>
          ))}
          {!TERMINAL_APPOINTMENT_STATUSES.has(row.status) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={move.isPending || cancel.isPending}
              onClick={() => setRescheduleTarget(row)}
            >
              {t('reschedule.action')}
            </Button>
          ) : null}
          {TERMINAL_APPOINTMENT_STATUSES.has(row.status) ? (
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

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-xs">
          <Field id="appt-department" label={t('filterDepartment')}>
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
          <Field id="appt-date" label={t('filterDate')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value || todayISO())}
              />
            )}
          </Field>
        </div>
        <div className="w-full max-w-xs">
          <Field id="appt-status" label={t('filterStatus')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t('allStatuses')}</option>
                {APPOINTMENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {actionError ? <DeskAlert title={t('actionFailed')} body={actionError} /> : null}

      {cancelTarget ? (
        <section
          aria-labelledby="appt-cancel-title"
          className="flex flex-col gap-3 border border-status-warning bg-surface px-4 py-3"
        >
          <h2 id="appt-cancel-title" className="text-body font-semibold text-primary">
            {t('cancel.title')}
          </h2>
          <p className="text-meta text-secondary">
            {t('cancel.intro', { time: formatTime(cancelTarget.startsAt) })}
          </p>
          <Field id="appt-cancel-reason" label={t('cancel.reason')} hint={t('cancel.reasonHint')}>
            {({ controlId, describedBy }) => (
              <Textarea
                id={controlId}
                aria-describedby={describedBy}
                rows={2}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={confirmCancel} disabled={cancel.isPending}>
              {cancel.isPending ? t('cancel.confirming') : t('cancel.confirm')}
            </Button>
            <Button variant="ghost" onClick={() => setCancelTarget(null)} disabled={cancel.isPending}>
              {t('cancel.dismiss')}
            </Button>
          </div>
        </section>
      ) : null}

      {rescheduleTarget ? (
        <ReschedulePanel
          appointment={rescheduleTarget}
          formatTime={formatTime}
          onDone={() => setRescheduleTarget(null)}
        />
      ) : null}

      {appointments.error ? (
        <DeskAlert title={t('unavailableTitle')} body={t('unavailableBody')} />
      ) : (
        <DataTable
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={appointments.isLoading}
          emptyMessage={t('empty')}
        />
      )}

      <BookingPanel departments={departments.data?.data ?? []} />

      <WaitlistPanel departments={departments.data?.data ?? []} providerName={providerName} />
    </div>
  );
}

/** One appointment row's patient name, resolved on demand (GAP-018). */
function PatientName({ id }: { id: string }) {
  const t = useTranslations('appointments');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}

function DeskAlert({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 border border-status-critical bg-status-critical-bg px-4 py-3"
    >
      <h2 className="text-body font-semibold text-status-critical">{title}</h2>
      <p className="text-meta text-secondary">{body}</p>
    </div>
  );
}

function ReschedulePanel({
  appointment,
  formatTime,
  onDone,
}: {
  appointment: AppointmentRow;
  formatTime: (iso: string) => string;
  onDone: () => void;
}) {
  const t = useTranslations('appointments.reschedule');
  const [date, setDate] = useState(() => (appointment.startsAt ?? '').slice(0, 10));
  const [startsAt, setStartsAt] = useState('');
  const [alert, setAlert] = useState<{ title: string; body: string } | null>(null);

  const slots = useSlots({
    providerId: appointment.providerId,
    departmentId: appointment.departmentId,
    date,
  });
  const reschedule = useRescheduleAppointment();

  const slotList = slots.data?.data.slots ?? [];

  function submit() {
    setAlert(null);
    if (!startsAt) {
      setAlert({ title: t('missingTitle'), body: t('missingBody') });
      return;
    }
    reschedule.mutate(
      { id: appointment.id, startsAt, version: appointment.version },
      {
        onSuccess: onDone,
        onError: (error) => {
          setAlert({
            title: error.code === 'INVALID_WORKFLOW_TRANSITION' ? t('staleTitle') : t('failedTitle'),
            body: error.code === 'INVALID_WORKFLOW_TRANSITION' ? t('staleBody') : t('failedBody'),
          });
        },
      },
    );
  }

  return (
    <section
      aria-labelledby="appt-reschedule-title"
      className="flex flex-col gap-3 border border-status-info bg-surface px-4 py-3"
    >
      <div>
        <h2 id="appt-reschedule-title" className="text-body font-semibold text-primary">
          {t('title')}
        </h2>
        <p className="text-meta text-secondary">
          {t('intro', { time: formatTime(appointment.startsAt) })}
        </p>
      </div>

      <div className="w-full max-w-xs">
        <Field id="reschedule-date" label={t('date')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value || todayISO());
                setStartsAt('');
              }}
            />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2 border border-border px-3 py-2">
        <legend className="px-1 text-meta font-medium text-secondary">{t('slots')}</legend>
        {slots.isLoading ? (
          <p className="text-meta text-tertiary">{t('slotsLoading')}</p>
        ) : slotList.length === 0 ? (
          <p className="text-meta text-secondary">{t('slotsNone')}</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('slots')}>
            {slotList.map((slot) => {
              const selectable = slot.status === 'AVAILABLE';
              const selected = startsAt === slot.startsAt;
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  aria-pressed={selected}
                  disabled={!selectable}
                  onClick={() => setStartsAt(slot.startsAt)}
                  title={slot.status}
                  className={cn(
                    'border px-2 py-1 text-meta tabular-nums',
                    selected
                      ? 'border-accent bg-surface-hover text-primary'
                      : selectable
                        ? 'border-border bg-surface text-primary hover:bg-surface-hover'
                        : 'border-border bg-surface-sunken text-tertiary line-through',
                  )}
                >
                  {formatTime(slot.startsAt)}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      {alert ? <DeskAlert title={alert.title} body={alert.body} /> : null}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={submit} disabled={reschedule.isPending || !startsAt}>
          {reschedule.isPending ? t('submitting') : t('confirm')}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={reschedule.isPending}>
          {t('dismiss')}
        </Button>
      </div>
    </section>
  );
}

function BookingPanel({ departments }: { departments: readonly { id: string; name: string; active: boolean }[] }) {
  const t = useTranslations('appointments.booking');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [patientId, setPatientId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [date, setDate] = useState(() => todayISO());
  const [startsAt, setStartsAt] = useState('');
  const [mode, setMode] = useState<AppointmentMode>('IN_PERSON');
  const [appointmentType, setAppointmentType] = useState('');
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<{ time: string } | null>(null);
  const [error, setError] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const search = usePatientSearch(debounced);
  const providers = useProviderDirectory(departmentId || undefined);
  const slots = useSlots(providerId && departmentId ? { providerId, departmentId, date } : null);
  const book = useBookAppointment();

  const results = search.data?.data.items ?? [];
  const selectedPatient = results.find((patient) => patient.id === patientId) ?? null;
  const slotList = slots.data?.data.slots ?? [];

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
      new Date(iso),
    );

  function submit() {
    setError(null);
    if (!patientId || !departmentId || !providerId || !startsAt) {
      setError({ title: t('missingTitle'), body: t('missingBody') });
      return;
    }
    book.mutate(
      {
        patientId,
        providerId,
        departmentId,
        branchId: SCHEDULING_BRANCH_ID,
        startsAt,
        mode,
        ...(appointmentType.trim() ? { appointmentType: appointmentType.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: (appointment) => setReceipt({ time: formatTime(appointment.startsAt) }),
        onError: (bookError) => {
          setError({
            title: bookError.code === 'APPOINTMENT_CONFLICT' ? t('conflictTitle') : t('failedTitle'),
            body: bookError.code === 'APPOINTMENT_CONFLICT' ? t('conflictBody') : t('failedBody'),
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
    setProviderId('');
    setDate(todayISO());
    setStartsAt('');
    setMode('IN_PERSON');
    setAppointmentType('');
    setReason('');
    setReceipt(null);
    setError(null);
  }

  return (
    <section aria-labelledby="booking-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="booking-title" className="text-heading-xs font-semibold text-primary">
            {t('title')}
          </h2>
          <p className="text-meta text-secondary">{t('intro')}</p>
        </div>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls="booking-body"
          onClick={() => setOpen((value) => !value)}
        >
          <CalendarPlus aria-hidden className="size-4" strokeWidth={1.5} />
          {open ? t('hide') : t('show')}
        </Button>
      </div>

      {open ? (
        <div id="booking-body" className="flex flex-col gap-3">
          {receipt ? (
            <EmptyState
              headingLevel={3}
              icon={Clock}
              title={t('booked')}
              description={t('bookedBody', { time: receipt.time })}
              action={
                <Button variant="secondary" onClick={reset}>
                  {t('bookAnother')}
                </Button>
              }
            />
          ) : (
            <>
              {error ? <DeskAlert title={error.title} body={error.body} /> : null}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <Field id="booking-search" label={t('searchLabel')}>
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
                              patientId === patient.id
                                ? 'bg-surface-hover'
                                : 'bg-surface hover:bg-surface-hover',
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

                  <Field id="booking-department" label={t('department')} required>
                    {({ controlId, describedBy }) => (
                      <Select
                        id={controlId}
                        aria-describedby={describedBy}
                        value={departmentId}
                        onChange={(event) => {
                          setDepartmentId(event.target.value);
                          setProviderId('');
                          setStartsAt('');
                        }}
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

                  <Field id="booking-provider" label={t('provider')} required>
                    {({ controlId, describedBy }) => (
                      <Select
                        id={controlId}
                        aria-describedby={describedBy}
                        value={providerId}
                        disabled={!departmentId}
                        onChange={(event) => {
                          setProviderId(event.target.value);
                          setStartsAt('');
                        }}
                      >
                        <option value="">{departmentId ? t('chooseProvider') : t('chooseDepartmentFirst')}</option>
                        {(providers.data?.data ?? []).map((provider: ProviderOption) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field id="booking-date" label={t('date')}>
                    {({ controlId, describedBy }) => (
                      <Input
                        id={controlId}
                        aria-describedby={describedBy}
                        type="date"
                        value={date}
                        onChange={(event) => {
                          setDate(event.target.value || todayISO());
                          setStartsAt('');
                        }}
                      />
                    )}
                  </Field>

                  <fieldset className="flex flex-col gap-2 border border-border px-3 py-2">
                    <legend className="px-1 text-meta font-medium text-secondary">{t('slots')}</legend>
                    {!providerId || !departmentId ? (
                      <p className="text-meta text-tertiary">{t('slotsPrompt')}</p>
                    ) : slots.isLoading ? (
                      <p className="text-meta text-tertiary">{t('slotsLoading')}</p>
                    ) : slotList.length === 0 ? (
                      <p className="text-meta text-secondary">{t('slotsNone')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-2" role="group" aria-label={t('slots')}>
                        {slotList.map((slot) => {
                          const selectable = slot.status === 'AVAILABLE';
                          const selected = startsAt === slot.startsAt;
                          return (
                            <button
                              key={slot.startsAt}
                              type="button"
                              aria-pressed={selected}
                              disabled={!selectable}
                              onClick={() => setStartsAt(slot.startsAt)}
                              title={slot.status}
                              className={cn(
                                'border px-2 py-1 text-meta tabular-nums',
                                selected
                                  ? 'border-accent bg-surface-hover text-primary'
                                  : selectable
                                    ? 'border-border bg-surface text-primary hover:bg-surface-hover'
                                    : 'border-border bg-surface-sunken text-tertiary line-through',
                              )}
                            >
                              {formatTime(slot.startsAt)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </fieldset>

                  <Field id="booking-mode" label={t('modeLabel')}>
                    {({ controlId, describedBy }) => (
                      <Select
                        id={controlId}
                        aria-describedby={describedBy}
                        value={mode}
                        onChange={(event) => setMode(event.target.value as AppointmentMode)}
                      >
                        {APPOINTMENT_MODES.map((value) => (
                          <option key={value} value={value}>
                            {t(`mode.${value}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field id="booking-type" label={t('appointmentType')} hint={t('appointmentTypeHint')}>
                    {({ controlId, describedBy }) => (
                      <Input
                        id={controlId}
                        aria-describedby={describedBy}
                        value={appointmentType}
                        onChange={(event) => setAppointmentType(event.target.value)}
                        placeholder={t('appointmentTypePlaceholder')}
                      />
                    )}
                  </Field>

                  <Field id="booking-reason" label={t('reason')}>
                    {({ controlId, describedBy }) => (
                      <Textarea
                        id={controlId}
                        aria-describedby={describedBy}
                        rows={2}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    )}
                  </Field>

                  <div>
                    <Button type="submit" disabled={book.isPending || !patientId || !providerId || !startsAt}>
                      {book.isPending ? t('submitting') : t('submit')}
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function WaitlistPanel({
  departments,
  providerName,
}: {
  departments: readonly { id: string; name: string; active: boolean }[];
  providerName: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('appointments.waitlist');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [patientId, setPatientId] = useState('');
  const [joinDepartmentId, setJoinDepartmentId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const waitlist = useWaitlist({
    departmentId: departmentId || undefined,
    status: status || undefined,
  });
  const search = usePatientSearch(debounced);
  const join = useJoinWaitlist();
  const accept = useAcceptWaitlistOffer();
  const decline = useDeclineWaitlistOffer();
  const leave = useLeaveWaitlist();

  const results = search.data?.data.items ?? [];
  const selectedPatient = results.find((patient) => patient.id === patientId) ?? null;
  const rows = waitlist.data?.data.items ?? [];

  function submitJoin() {
    setError(null);
    if (!patientId || !joinDepartmentId) {
      setError({ title: t('missingTitle'), body: t('missingBody') });
      return;
    }
    join.mutate(
      {
        patientId,
        branchId: SCHEDULING_BRANCH_ID,
        departmentId: joinDepartmentId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      {
        onSuccess: () => {
          setJoined(true);
          setQuery('');
          setDebounced('');
          setPatientId('');
          setJoinDepartmentId('');
          setNotes('');
        },
        onError: (joinError) => {
          setError({
            title: joinError.code === 'WAITLIST_DUPLICATE' ? t('duplicateTitle') : t('failedTitle'),
            body:
              joinError.code === 'WAITLIST_DUPLICATE'
                ? t('duplicateBody')
                : joinError.code === 'WAITLIST_FULL'
                  ? t('fullBody')
                  : t('failedBody'),
          });
        },
      },
    );
  }

  const columns: readonly DataTableColumn<WaitlistEntryRow>[] = [
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientName id={row.patientId} />,
    },
    {
      key: 'provider',
      header: t('columnProvider'),
      cell: (row) => (
        <span className="text-secondary">
          {row.providerId ? (providerName.get(row.providerId) ?? row.providerId) : t('anyProvider')}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      width: '9rem',
      cell: (row) => (
        <StatusPill
          tone={row.status === 'OFFERED' ? 'warning' : row.status === 'WAITING' ? 'info' : 'neutral'}
          size="sm"
          label={t(`status.${row.status}`)}
        />
      ),
    },
    {
      key: 'offered',
      header: t('columnOffered'),
      cell: (row) => (
        <span className="text-secondary">
          {row.offeredStartAt ? new Date(row.offeredStartAt).toISOString().slice(11, 16) : '—'}
        </span>
      ),
    },
    {
      key: 'notes',
      header: t('columnNotes'),
      cell: (row) => <span className="text-secondary">{row.notes ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: t('columnActions'),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {row.status === 'OFFERED' ? (
            <>
              <Button
                size="sm"
                disabled={accept.isPending}
                onClick={() => accept.mutate({ id: row.id })}
              >
                {t('accept')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={decline.isPending}
                onClick={() => decline.mutate({ id: row.id })}
              >
                {t('decline')}
              </Button>
            </>
          ) : null}
          {ACTIONABLE_WAITLIST_STATUSES.has(row.status) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={leave.isPending}
              onClick={() => leave.mutate({ id: row.id })}
            >
              {t('remove')}
            </Button>
          ) : null}
          {!ACTIONABLE_WAITLIST_STATUSES.has(row.status) && row.status !== 'ACCEPTED' ? (
            <span className="text-meta text-tertiary">—</span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby="waitlist-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="waitlist-title" className="text-heading-xs font-semibold text-primary">
            {t('title')}
          </h2>
          <p className="text-meta text-secondary">{t('intro')}</p>
        </div>
        <Button
          variant="secondary"
          aria-expanded={joinOpen}
          aria-controls="waitlist-join"
          onClick={() => {
            setJoinOpen((value) => !value);
            setJoined(false);
          }}
        >
          <ListPlus aria-hidden className="size-4" strokeWidth={1.5} />
          {joinOpen ? t('hideJoin') : t('showJoin')}
        </Button>
      </div>

      {joinOpen ? (
        <div id="waitlist-join" className="flex flex-col gap-3 border border-border bg-surface px-4 py-3">
          {joined ? (
            <EmptyState
              headingLevel={3}
              icon={ListPlus}
              title={t('joined')}
              description={t('joinedBody')}
              action={
                <Button variant="secondary" onClick={() => setJoined(false)}>
                  {t('joinAnother')}
                </Button>
              }
            />
          ) : (
            <>
              {error ? <DeskAlert title={error.title} body={error.body} /> : null}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Field id="waitlist-search" label={t('searchLabel')}>
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
                              patientId === patient.id
                                ? 'bg-surface-hover'
                                : 'bg-surface hover:bg-surface-hover',
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
                </div>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitJoin();
                  }}
                >
                  <div className="text-meta text-secondary">
                    {selectedPatient
                      ? t('selected', { name: selectedPatient.displayName })
                      : t('selectPrompt')}
                  </div>
                  <Field id="waitlist-department" label={t('department')} required>
                    {({ controlId, describedBy }) => (
                      <Select
                        id={controlId}
                        aria-describedby={describedBy}
                        value={joinDepartmentId}
                        onChange={(event) => setJoinDepartmentId(event.target.value)}
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
                  <Field id="waitlist-notes" label={t('notes')} hint={t('notesHint')}>
                    {({ controlId, describedBy }) => (
                      <Textarea
                        id={controlId}
                        aria-describedby={describedBy}
                        rows={2}
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    )}
                  </Field>
                  <div>
                    <Button type="submit" disabled={join.isPending || !patientId || !joinDepartmentId}>
                      {join.isPending ? t('submitting') : t('submit')}
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-xs">
          <Field id="waitlist-filter-department" label={t('filterDepartment')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t('allDepartments')}</option>
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
        </div>
        <div className="w-full max-w-xs">
          <Field id="waitlist-filter-status" label={t('filterStatus')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t('allStatuses')}</option>
                {(['WAITING', 'OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REMOVED'] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(`status.${value}`)}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {waitlist.error ? (
        <DeskAlert title={t('unavailableTitle')} body={t('unavailableBody')} />
      ) : (
        <DataTable
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={waitlist.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </section>
  );
}
