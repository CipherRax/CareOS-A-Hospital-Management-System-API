'use client';

import { useTranslations } from 'next-intl';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { usePortalAppointments } from '@/lib/data/queries';
import type {
  PortalAppointment,
  PortalAppointmentMode,
  PortalAppointmentStatus,
} from '@/lib/data/portal';

/**
 * Portal appointments `GET /portal/me/appointments`.
 *
 * Self-scoped and read-only: the API returns only the caller's own bookings, and
 * this screen never names a patient id, so there is nothing here to tamper with to
 * read someone else's diary.
 *
 * Rendered as a real table rather than a card list because an appointment is
 * inherently tabular — when, where, what state — and a patient scanning "is my
 * scan still confirmed?" reads down the status column. The row links nothing: the
 * portal has no appointment-detail route, so the table opts into the focusable
 * scroll region instead (see `DataTable`).
 *
 * Times are pinned to UTC, matching the profile screen: an appointment at 09:00
 * must not render as 08:00 because a browser sits in another zone, and no
 * `Date.now()` is used in render so server and client agree.
 *
 * Only the first page is requested. Rather than silently truncate, a footer names
 * how many of the total are shown — a patient must not read a partial list as the
 * whole diary.
 */

const STATUS_KEYS: Record<PortalAppointmentStatus, string> = {
  BOOKED: 'booked',
  CONFIRMED: 'confirmed',
  CHECKED_IN: 'checkedIn',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'noShow',
  RESCHEDULED: 'rescheduled',
};

/** Tone per status. A cancelled visit and a completed one must not look alike. */
const STATUS_TONE: Record<PortalAppointmentStatus, StatusTone> = {
  BOOKED: 'info',
  CONFIRMED: 'info',
  CHECKED_IN: 'success',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'critical',
  NO_SHOW: 'warning',
  RESCHEDULED: 'warning',
};

const MODE_KEYS: Record<PortalAppointmentMode, string> = {
  IN_PERSON: 'inPerson',
  VIRTUAL: 'virtual',
};

const PAGE_LIMIT = 25;

export function PortalAppointments() {
  const t = useTranslations('portal');
  const query = usePortalAppointments({ page: 1, limit: PAGE_LIMIT });

  const page = query.data?.data;
  const columns: readonly DataTableColumn<PortalAppointment>[] = [
    {
      key: 'when',
      header: t('appointments.columnWhen'),
      cell: (row) => formatInstantDateTime(row.startsAt),
    },
    {
      key: 'status',
      header: t('appointments.columnStatus'),
      cell: (row) => (
        <StatusPill
          tone={STATUS_TONE[row.status]}
          label={t(`appointmentStatus.${STATUS_KEYS[row.status]}`)}
          size="sm"
        />
      ),
    },
    {
      key: 'mode',
      header: t('appointments.columnMode'),
      cell: (row) => t(`appointmentMode.${MODE_KEYS[row.mode]}`),
    },
    {
      key: 'reason',
      header: t('appointments.columnReason'),
      cell: (row) => row.reason ?? <span className="text-tertiary">{t('appointments.notRecorded')}</span>,
    },
  ];

  return (
    <section aria-labelledby="portal-appointments-title" className="flex flex-col gap-6">
      <header>
        <h1 id="portal-appointments-title" className="text-heading-sm font-semibold text-primary">
          {t('appointments.title')}
        </h1>
        <p className="mt-1 text-body text-secondary">{t('appointments.description')}</p>
      </header>

      {query.isError ? (
        <p
          role="alert"
          className="rounded-lg border border-status-critical bg-surface px-4 py-3 text-body text-status-critical"
        >
          {t('appointments.error')}
        </p>
      ) : (
        <>
          <DataTable
            caption={t('appointments.caption')}
            columns={columns}
            rows={page?.rows ?? []}
            rowKey={(row) => row.id}
            loading={query.isPending}
            scrollable
            emptyMessage={t('appointments.empty')}
          />
          {page && page.total > page.rows.length ? (
            <p className="text-meta text-secondary">
              {t('appointments.showing', {
                shown: page.rows.length,
                total: page.total,
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Formats an ISO instant as a UTC date and time — stable between server and client. */
function formatInstantDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(parsed);
}
