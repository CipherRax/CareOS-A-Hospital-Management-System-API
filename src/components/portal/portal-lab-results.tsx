'use client';

import { useTranslations } from 'next-intl';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { usePortalLabResults } from '@/lib/data/queries';
import type { PortalLabResult } from '@/lib/data/portal';

/**
 * Portal lab results `GET /portal/me/lab-results`.
 *
 * Release-gated server-side: the query only returns rows whose order is
 * `RELEASED`, so a result a clinician has not signed out never reaches this screen
 * — the client does not filter and cannot be trusted to. Self-scoped like the rest
 * of the portal.
 *
 * The three states read as words, never colour alone: `isCritical` outranks
 * `isAbnormal`. A critical value is the one thing on this page a patient must not
 * skim past, so its pill is the only critical-tone one and carries a distinct
 * label. An abnormal-but-not-critical value is a softer "outside range".
 *
 * `value` is the result as the lab reported it, rendered verbatim with its unit;
 * the reference range is shown beside it so the patient can see for themselves.
 * Dates are UTC-pinned like the rest of the portal (no `Date.now()` in render).
 */

const PAGE_LIMIT = 25;

export function PortalLabResults() {
  const t = useTranslations('portal');
  const query = usePortalLabResults({ page: 1, limit: PAGE_LIMIT });

  const page = query.data?.data;
  const columns: readonly DataTableColumn<PortalLabResult>[] = [
    {
      key: 'test',
      header: t('labResults.columnTest'),
      cell: (row) => row.testName ?? <span className="text-tertiary">{t('labResults.unnamedTest')}</span>,
    },
    {
      key: 'result',
      header: t('labResults.columnResult'),
      numeric: true,
      cell: (row) => (row.unit ? `${row.value} ${row.unit}` : row.value),
    },
    {
      key: 'reference',
      header: t('labResults.columnReference'),
      cell: (row) => formatReference(row) ?? <span className="text-tertiary">{t('labResults.notRecorded')}</span>,
    },
    {
      key: 'status',
      header: t('labResults.columnStatus'),
      cell: (row) => {
        const { tone, key } = resultStatus(row);
        return <StatusPill tone={tone} label={t(`labResultStatus.${key}`)} size="sm" />;
      },
    },
    {
      key: 'released',
      header: t('labResults.columnReleased'),
      cell: (row) => (row.releasedAt ? formatInstant(row.releasedAt) : <span className="text-tertiary">{t('labResults.notRecorded')}</span>),
    },
  ];

  return (
    <section aria-labelledby="portal-lab-results-title" className="flex flex-col gap-6">
      <header>
        <h1 id="portal-lab-results-title" className="text-heading-sm font-semibold text-primary">
          {t('labResults.title')}
        </h1>
        <p className="mt-1 text-body text-secondary">{t('labResults.description')}</p>
      </header>

      {query.isError ? (
        <p
          role="alert"
          className="rounded-lg border border-status-critical bg-surface px-4 py-3 text-body text-status-critical"
        >
          {t('labResults.error')}
        </p>
      ) : (
        <>
          <DataTable
            caption={t('labResults.caption')}
            columns={columns}
            rows={page?.rows ?? []}
            rowKey={(row) => row.id}
            loading={query.isPending}
            scrollable
            emptyMessage={t('labResults.empty')}
          />
          {page && page.total > page.rows.length ? (
            <p className="text-meta text-secondary">
              {t('labResults.showing', { shown: page.rows.length, total: page.total })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Critical outranks abnormal; otherwise the result is within range. */
function resultStatus(row: PortalLabResult): { tone: StatusTone; key: string } {
  if (row.isCritical) return { tone: 'critical', key: 'critical' };
  if (row.isAbnormal) return { tone: 'warning', key: 'abnormal' };
  return { tone: 'success', key: 'normal' };
}

/** Builds `min – max`, degrading to an open bound when only one side is recorded. */
function formatReference(row: PortalLabResult): string | null {
  const min = row.referenceMin;
  const max = row.referenceMax;
  if (min && max) return `${min} – ${max}`;
  if (min) return `≥ ${min}`;
  if (max) return `≤ ${max}`;
  return null;
}

/** Formats an ISO instant as a UTC date — stable between server and client. */
function formatInstant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
