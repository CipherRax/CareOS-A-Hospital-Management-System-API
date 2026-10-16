'use client';

import { Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { useReportExport } from '@/lib/data/queries';
import {
  isReportExpired,
  reportDownloadUrl,
  type ReportExportRow,
} from '@/lib/data/reports';
import { REPORT_STATUS_TONE } from '@/components/reports/reports-worklist';

/**
 * Report export detail (F10 analytics & reports).
 *
 * `GET /reports/exports/{id}` types its 200 as the request DTO while the service
 * answers the record (GAP-020 family), so the body is validated in
 * `src/lib/data/reports.ts`. Generation is asynchronous: a PENDING row is polled
 * until it settles, and the artifact is only downloadable once READY and not past
 * its 24-hour expiry.
 *
 * The download is a plain link to the same-origin proxy rather than a fetch: the
 * proxy streams the bytes behind the session cookie, and a multi-megabyte patient
 * export should not be loaded onto the JS heap. The cost is that a 409/410 from
 * the stream cannot be surfaced in-app — the link is therefore only offered for a
 * READY, unexpired row, and EXPIRED is shown as an explicit notice instead.
 */
export function ReportWorkspaceScreen({ reportId }: { reportId: string }) {
  const t = useTranslations('reports');
  const report = useReportExport(reportId);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold text-primary">{t('detailTitle')}</h1>
        <p className="text-meta text-secondary">{t('detailIntro')}</p>
      </header>

      {report.isLoading && !report.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingExport')}
        </p>
      ) : report.error ? (
        <EmptyState
          title={t('detailUnavailableTitle')}
          description={t('detailUnavailableBody')}
          headingLevel={2}
        />
      ) : !report.data ? (
        <EmptyState
          title={t('detailUnavailableTitle')}
          description={t('detailUnavailableBody')}
          headingLevel={2}
        />
      ) : (
        <ReportBody report={report.data.data} />
      )}
    </div>
  );
}

function ReportBody({ report }: { report: ReportExportRow }) {
  const t = useTranslations('reports');
  const locale = useLocale();

  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  const expired = isReportExpired(report, Date.now());
  const downloadable = report.status === 'READY' && !expired;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-subheading font-semibold text-primary">
            {t(`type.${report.reportType}`)}
          </h2>
          <StatusPill
            tone={REPORT_STATUS_TONE[report.status]}
            label={t(`status.${report.status}`)}
          />
          <span className="text-meta text-tertiary">{t(`format.${report.format}`)}</span>
        </div>

        {report.status === 'PENDING' ? (
          <p role="status" className="text-meta text-secondary">
            {t('pendingNotice')}
          </p>
        ) : null}

        {report.status === 'EXPIRED' || (report.status === 'READY' && expired) ? (
          <p role="status" className="text-meta text-status-warning">
            {t('expiredNotice')}
          </p>
        ) : null}

        {report.status === 'FAILED' ? (
          <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
            <h3 className="text-body font-semibold text-status-critical">{t('failedTitle')}</h3>
            <p className="text-meta text-secondary">{report.error ?? t('failedBody')}</p>
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-3 text-meta sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('fieldCreated')}</dt>
            <dd className="tabular-nums text-primary">{formatDateTime(report.createdAt)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('fieldCompleted')}</dt>
            <dd className="tabular-nums text-primary">
              {report.completedAt ? formatDateTime(report.completedAt) : t('unset')}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('fieldExpires')}</dt>
            <dd className="tabular-nums text-primary">
              {report.expiresAt ? formatDateTime(report.expiresAt) : t('unset')}
            </dd>
          </div>
        </dl>

        <div className="flex justify-end">
          {downloadable ? (
            <Button asChild variant="primary">
              <a href={reportDownloadUrl(report.id)}>
                <Download aria-hidden className="size-4" />
                {t('downloadAction')}
              </a>
            </Button>
          ) : (
            <Button variant="primary" disabled>
              <Download aria-hidden className="size-4" />
              {t('downloadAction')}
            </Button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-subheading font-semibold text-primary">{t('summaryHeading')}</h2>
        {report.summary && Object.keys(report.summary).length > 0 ? (
          <SummaryList summary={report.summary} />
        ) : (
          <p className="text-meta text-tertiary">{t('summaryEmpty')}</p>
        )}
      </section>
    </div>
  );
}

/**
 * The export `summary` is a loose `Record<string, unknown>` — numbers and one
 * level of nested counts. It is rendered leniently: a nested object becomes a
 * labelled sub-list, anything else is stringified, so an unexpected shape cannot
 * crash the desk. Known keys are translated; an unknown key is humanised rather
 * than looking up a missing message (which next-intl would reject).
 */
function SummaryList({ summary }: { summary: Record<string, unknown> }) {
  const t = useTranslations('reports');
  const labels: Record<string, string> = {
    total: t('summaryKey.total'),
    sexes: t('summaryKey.sexes'),
    noShowRate: t('summaryKey.noShowRate'),
    MALE: t('summaryValue.MALE'),
    FEMALE: t('summaryValue.FEMALE'),
  };
  const label = (key: string) => labels[key] ?? humanize(key);

  return (
    <dl className="flex flex-col gap-3 text-meta">
      {Object.entries(summary).map(([key, value]) => (
        <div key={key} className="flex flex-col gap-1">
          <dt className="font-medium text-primary">{label(key)}</dt>
          {isPlainObject(value) ? (
            <dd className="grid grid-cols-2 gap-x-6 gap-y-1 pl-3 text-secondary sm:grid-cols-3">
              {Object.entries(value).map(([nestedKey, nestedValue]) => (
                <span key={nestedKey} className="flex justify-between gap-2">
                  <span className="text-tertiary">{label(nestedKey)}</span>
                  <span className="tabular-nums text-primary">{renderScalar(nestedValue)}</span>
                </span>
              ))}
            </dd>
          ) : (
            <dd className="tabular-nums text-secondary">{renderScalar(value)}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function humanize(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderScalar(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
