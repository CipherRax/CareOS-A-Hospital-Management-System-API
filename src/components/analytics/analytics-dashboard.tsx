'use client';

import { BarChart3 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { MoneyText } from '@/components/clinical/money-text';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import {
  useAnalyticsMetrics,
  useBranchOptions,
  useDepartmentList,
  useOrgCurrency,
} from '@/lib/data/queries';
import type { AnalyticsMetrics, MetricsSeriesRow } from '@/lib/data/analytics';

/**
 * Analytics dashboard (F10 analytics & reports): operational metrics.
 *
 * `GET /analytics/metrics` is typed `unknown` (a large nested object), so the
 * series and summary are validated structurally in `src/lib/data/analytics.ts`
 * and fail closed, while the point-in-time `snapshots` block stays loose and is
 * rendered generically — a block the API adds appears on the dashboard instead of
 * blanking it.
 *
 * The service labels every measurement in its own words. Those `label` strings
 * are surfaced verbatim: they are the honest boundary between a measurement and a
 * claim, and paraphrasing them in the UI copy is how the two drift apart.
 */

type MetricKind = 'count' | 'percent' | 'minutes' | 'money';

/** The series columns, in reading order. `date` is prepended separately. */
const SERIES_FIELDS: readonly { key: SeriesKey; kind: MetricKind }[] = [
  { key: 'patientVolume', kind: 'count' },
  { key: 'appointmentVolume', kind: 'count' },
  { key: 'noShowRate', kind: 'percent' },
  { key: 'cancellationRate', kind: 'percent' },
  { key: 'rescheduleRate', kind: 'percent' },
  { key: 'avgWaitingMinutes', kind: 'minutes' },
  { key: 'avgConsultationMinutes', kind: 'minutes' },
  { key: 'revenue', kind: 'money' },
  { key: 'invoicesIssued', kind: 'count' },
  { key: 'invoicesTotal', kind: 'money' },
  { key: 'refundsTotal', kind: 'money' },
  { key: 'labTatAvgMinutes', kind: 'minutes' },
  { key: 'admissions', kind: 'count' },
  { key: 'discharges', kind: 'count' },
  { key: 'emergencyArrivals', kind: 'count' },
  { key: 'feedbackSubmitted', kind: 'count' },
];

type SeriesKey = Exclude<keyof MetricsSeriesRow, 'date'>;

/** The headline summary fields, in reading order. */
const SUMMARY_FIELDS: readonly { key: string; kind: MetricKind }[] = [
  { key: 'patientVolume', kind: 'count' },
  { key: 'visitsCompleted', kind: 'count' },
  { key: 'appointmentVolume', kind: 'count' },
  { key: 'appointmentsCompleted', kind: 'count' },
  { key: 'noShowRate', kind: 'percent' },
  { key: 'cancellationRate', kind: 'percent' },
  { key: 'rescheduleRate', kind: 'percent' },
  { key: 'avgWaitingMinutes', kind: 'minutes' },
  { key: 'avgConsultationMinutes', kind: 'minutes' },
  { key: 'revenue', kind: 'money' },
  { key: 'invoicesIssued', kind: 'count' },
  { key: 'invoicesTotal', kind: 'money' },
  { key: 'refundsTotal', kind: 'money' },
  { key: 'labTatAvgMinutes', kind: 'minutes' },
  { key: 'admissions', kind: 'count' },
  { key: 'discharges', kind: 'count' },
  { key: 'emergencyArrivals', kind: 'count' },
  { key: 'prescriptionsDispensed', kind: 'count' },
  { key: 'feedbackSubmitted', kind: 'count' },
];

const SNAPSHOT_TITLES = [
  'outstandingInvoices',
  'medicationWastage',
  'stockTurnover',
  'providerUtilization',
  'bedOccupancy',
  'claimAging',
  'emergencyIntake',
  'emergencyRequests',
  'revenue',
] as const;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export function AnalyticsScreen() {
  const t = useTranslations('analytics');
  const [applied, setApplied] = useState<{
    from: string;
    to: string;
    granularity: 'day' | 'week';
    branchId: string;
    departmentId: string;
  }>({ from: '', to: '', granularity: 'day', branchId: '', departmentId: '' });

  const metrics = useAnalyticsMetrics({
    from: applied.from ? new Date(`${applied.from}T00:00:00Z`).toISOString() : undefined,
    to: applied.to ? new Date(`${applied.to}T23:59:59Z`).toISOString() : undefined,
    granularity: applied.granularity,
    branchId: applied.branchId || undefined,
    departmentId: applied.departmentId || undefined,
  });

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold text-primary">{t('title')}</h1>
        <p className="text-meta text-secondary">{t('intro')}</p>
      </header>

      <WindowControls applied={applied} onApply={setApplied} />

      {metrics.isLoading && !metrics.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : metrics.error || !metrics.data ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={BarChart3}
          headingLevel={2}
        />
      ) : (
        <MetricsBody metrics={metrics.data.data} />
      )}
    </div>
  );
}

interface AppliedWindow {
  from: string;
  to: string;
  granularity: 'day' | 'week';
  branchId: string;
  departmentId: string;
}

function WindowControls({
  applied,
  onApply,
}: {
  applied: AppliedWindow;
  onApply: (next: AppliedWindow) => void;
}) {
  const t = useTranslations('analytics');
  const branches = useBranchOptions();
  const departments = useDepartmentList();
  const [draft, setDraft] = useState<AppliedWindow>(applied);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('windowHeading')}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="analytics-from" label={t('fromLabel')} hint={t('fromHint')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              type="date"
              aria-describedby={describedBy}
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          )}
        </Field>
        <Field id="analytics-to" label={t('toLabel')} hint={t('toHint')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              type="date"
              aria-describedby={describedBy}
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          )}
        </Field>
        <Field id="analytics-granularity" label={t('granularityLabel')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={draft.granularity}
              onChange={(event) =>
                setDraft({ ...draft, granularity: event.target.value as AppliedWindow['granularity'] })
              }
            >
              <option value="day">{t('granularityDay')}</option>
              <option value="week">{t('granularityWeek')}</option>
            </Select>
          )}
        </Field>
        <Field id="analytics-branch" label={t('branchLabel')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={draft.branchId}
              onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}
            >
              <option value="">{t('allBranches')}</option>
              {(branches.data?.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="analytics-department" label={t('departmentLabel')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={draft.departmentId}
              onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}
            >
              <option value="">{t('allDepartments')}</option>
              {(departments.data?.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            const cleared: AppliedWindow = {
              from: '',
              to: '',
              granularity: 'day',
              branchId: '',
              departmentId: '',
            };
            setDraft(cleared);
            onApply(cleared);
          }}
        >
          {t('resetWindow')}
        </Button>
        <Button variant="primary" onClick={() => onApply(draft)}>
          {t('applyWindow')}
        </Button>
      </div>
    </section>
  );
}

function MetricsBody({ metrics }: { metrics: AnalyticsMetrics }) {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const currency = useOrgCurrency();

  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`),
    );

  const summaryEntries = SUMMARY_FIELDS.filter((field) => field.key in metrics.summary);

  const columns: readonly DataTableColumn<MetricsSeriesRow>[] = [
    {
      key: 'date',
      header: t('metric.date'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">{formatDate(row.date)}</span>
      ),
    },
    ...SERIES_FIELDS.map((field) => ({
      key: field.key,
      header: t(`metric.${field.key}`),
      numeric: true,
      cell: (row: MetricsSeriesRow) => (
        <MetricValue value={row[field.key]} kind={field.kind} currency={currency} locale={locale} />
      ),
    })),
  ];

  return (
    <>
      <section className="flex flex-col gap-2">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-meta">
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('periodLabel')}</dt>
            <dd className="tabular-nums text-primary">
              {t('periodValue', {
                from: formatDateTime(metrics.period.from),
                to: formatDateTime(metrics.period.to),
              })}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('scopeLabel')}</dt>
            <dd className="text-primary">
              {metrics.scope.branchId || metrics.scope.departmentId
                ? t('scopeFiltered')
                : t('scopeOrgWide')}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-tertiary">{t('granularityLabel')}</dt>
            <dd className="text-primary">
              {metrics.granularity === 'week' ? t('granularityWeek') : t('granularityDay')}
            </dd>
          </div>
        </dl>
        {metrics.label ? <p className="text-caption text-tertiary">{metrics.label}</p> : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('summaryHeading')}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {summaryEntries.map((field) => (
            <div
              key={field.key}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3"
            >
              <dt className="text-caption text-tertiary">{t(`metric.${field.key}`)}</dt>
              <dd className="text-heading font-semibold text-primary">
                <MetricValue
                  value={metrics.summary[field.key] ?? null}
                  kind={field.kind}
                  currency={currency}
                  locale={locale}
                />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('seriesHeading')}</h2>
        <DataTable<MetricsSeriesRow>
          caption={t('seriesCaption')}
          columns={columns}
          rows={metrics.series}
          rowKey={(row) => row.date}
          scrollable
          emptyMessage={t('emptySeries')}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('snapshotsHeading')}</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.entries(metrics.snapshots).map(([name, value]) => (
            <SnapshotCard key={name} name={name} value={value} currency={currency} locale={locale} />
          ))}
        </div>
      </section>
    </>
  );
}

function MetricValue({
  value,
  kind,
  currency,
  locale,
}: {
  value: number | string | null;
  kind: MetricKind;
  currency: string;
  locale: string;
}) {
  const t = useTranslations('analytics');
  if (value === null || value === '') return <span className="text-tertiary">—</span>;
  if (kind === 'money') return <MoneyText amount={String(value)} currency={currency} />;
  if (kind === 'percent') {
    return typeof value === 'number' ? (
      <span>{new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)}</span>
    ) : (
      <span className="text-tertiary">—</span>
    );
  }
  if (kind === 'minutes') {
    return typeof value === 'number' ? <span>{t('minutes', { value })}</span> : <span className="text-tertiary">—</span>;
  }
  return typeof value === 'number' ? (
    <span>{new Intl.NumberFormat(locale).format(value)}</span>
  ) : (
    <span>{value}</span>
  );
}

/**
 * One point-in-time snapshot block. The block's `label` is the API's own
 * description and is shown verbatim; the measurements inside are rendered
 * generically so a new block appears without a code change. A two-decimal string
 * is treated as money, which is how every money value in this payload is encoded
 * (ADR-029).
 */
function SnapshotCard({
  name,
  value,
  currency,
  locale,
}: {
  name: string;
  value: unknown;
  currency: string;
  locale: string;
}) {
  const t = useTranslations('analytics');
  const known = (SNAPSHOT_TITLES as readonly string[]).includes(name);
  const title = known ? t(`snapshot.${name}`) : humanize(name);
  const label = isRecord(value) && typeof value.label === 'string' ? value.label : null;
  const entries = isRecord(value)
    ? Object.entries(value).filter(([key]) => key !== 'label')
    : [];

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-body font-semibold text-primary">{title}</h3>
        {label ? <p className="text-caption text-tertiary">{label}</p> : null}
      </div>
      {entries.length > 0 ? (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {entries.map(([key, member]) => (
            <div key={key} className="flex flex-col gap-0.5">
              <dt className="text-caption text-tertiary">{humanize(key)}</dt>
              <dd className="text-meta text-primary">
                <RenderNode value={member} currency={currency} locale={locale} depth={0} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-meta text-primary">
          <RenderNode value={value} currency={currency} locale={locale} depth={0} />
        </p>
      )}
    </section>
  );
}

/** Renders a loose snapshot value: scalars, nested objects and small arrays. */
function RenderNode({
  value,
  currency,
  locale,
  depth,
}: {
  value: unknown;
  currency: string;
  locale: string;
  depth: number;
}): React.ReactNode {
  if (value === null || value === undefined) return '—';

  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return (
      <ul className="flex flex-col gap-0.5">
        {value.map((item, index) => (
          <li key={index}>
            <RenderNode value={item} currency={currency} locale={locale} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (isRecord(value)) {
    if (depth >= 3) return '…';
    return (
      <dl className="flex flex-col gap-0.5">
        {Object.entries(value).map(([key, member]) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="text-caption text-tertiary">{humanize(key)}</dt>
            <dd className="tabular-nums text-primary">
              <RenderNode value={member} currency={currency} locale={locale} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <>{formatScalar(value, currency, locale)}</>;
}

function formatScalar(value: unknown, currency: string, locale: string): React.ReactNode {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === 'string') {
    // A two-decimal numeric string is money in this payload (ADR-029).
    if (DECIMAL_STRING.test(value)) return <MoneyText amount={value} currency={currency} />;
    return value;
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Turns an API field key into a readable label for keys we do not translate. */
function humanize(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
