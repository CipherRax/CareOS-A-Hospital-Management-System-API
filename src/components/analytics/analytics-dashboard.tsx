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
  useAnalyticsBottleneck,
  useAnalyticsCapacity,
  useAnalyticsMetrics,
  useBranchOptions,
  useDepartmentList,
  useOrgCurrency,
} from '@/lib/data/queries';
import type {
  AnalyticsBottleneck,
  AnalyticsCapacity,
  AnalyticsMetrics,
  AnalyticsMetricsQuery,
  BottleneckStage,
  ForecastResult,
  MetricsSeriesRow,
} from '@/lib/data/analytics';

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

  const window: AnalyticsMetricsQuery = {
    from: applied.from ? new Date(`${applied.from}T00:00:00Z`).toISOString() : undefined,
    to: applied.to ? new Date(`${applied.to}T23:59:59Z`).toISOString() : undefined,
    branchId: applied.branchId || undefined,
    departmentId: applied.departmentId || undefined,
  };

  const metrics = useAnalyticsMetrics({ ...window, granularity: applied.granularity });

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

      <BottleneckSection window={window} />
      <CapacitySection window={window} />
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

/**
 * Journey bottleneck ranking (F10 slice 3). `GET /analytics/bottleneck` is typed
 * `unknown`; the stages are validated and ranked by mean duration in
 * `src/lib/data/analytics.ts`. The service's interpretation sentence is shown
 * verbatim above the table — it states exactly what the numbers are averages
 * *of*, including that LAB/PHARMACY/BILLING use order-level timestamps.
 */
type RankedStage = BottleneckStage & { rank: number };

function BottleneckSection({ window }: { window: AnalyticsMetricsQuery }) {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const bottleneck = useAnalyticsBottleneck(window);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-subheading font-semibold text-primary">{t('bottleneckHeading')}</h2>
      {bottleneck.isLoading && !bottleneck.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : bottleneck.error || !bottleneck.data ? (
        <p role="alert" className="text-meta text-secondary">
          {t('bottleneckUnavailable')}
        </p>
      ) : (
        <BottleneckBody bottleneck={bottleneck.data.data} locale={locale} />
      )}
    </section>
  );
}

function BottleneckBody({ bottleneck, locale }: { bottleneck: AnalyticsBottleneck; locale: string }) {
  const t = useTranslations('analytics');
  const rows: RankedStage[] = bottleneck.stages.map((stage, index) => ({
    ...stage,
    rank: index + 1,
  }));
  const minutes = (value: number | null) =>
    value === null ? '—' : <span>{t('minutes', { value })}</span>;
  const columns: readonly DataTableColumn<RankedStage>[] = [
    { key: 'rank', header: t('bottleneckRank'), numeric: true, cell: (row) => row.rank },
    { key: 'label', header: t('bottleneckStage'), cell: (row) => row.label },
    { key: 'avgMinutes', header: t('bottleneckAvg'), numeric: true, cell: (row) => minutes(row.avgMinutes) },
    { key: 'medianMinutes', header: t('bottleneckMedian'), numeric: true, cell: (row) => minutes(row.medianMinutes) },
    {
      key: 'samples',
      header: t('bottleneckSamples'),
      numeric: true,
      cell: (row) => new Intl.NumberFormat(locale).format(row.samples),
    },
  ];

  return (
    <>
      {bottleneck.interpretation ? (
        <p className="text-caption text-tertiary">{bottleneck.interpretation}</p>
      ) : null}
      <DataTable<RankedStage>
        caption={t('bottleneckCaption')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        emptyMessage={t('bottleneckEmpty')}
      />
    </>
  );
}

/**
 * Capacity planning (F10 slice 3). `GET /analytics/capacity` bundles peak times,
 * department load, provider booking fill, bed occupancy and an embedded
 * appointment-demand forecast. The whole payload fails closed, except the
 * forecast: a malformed forecast leaves the rest of the panel readable (see
 * `readAnalyticsCapacity`), and the forecast's own notes travel with it.
 */
function CapacitySection({ window }: { window: AnalyticsMetricsQuery }) {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const capacity = useAnalyticsCapacity(window);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-subheading font-semibold text-primary">{t('capacityHeading')}</h2>
      {capacity.isLoading && !capacity.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : capacity.error || !capacity.data ? (
        <p role="alert" className="text-meta text-secondary">
          {t('capacityUnavailable')}
        </p>
      ) : (
        <CapacityBody capacity={capacity.data.data} locale={locale} />
      )}
    </section>
  );
}

function CapacityBody({
  capacity,
  locale,
}: {
  capacity: AnalyticsCapacity;
  locale: string;
}) {
  const t = useTranslations('analytics');
  const formatPercent = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`),
    );

  const providerColumns: readonly DataTableColumn<AnalyticsCapacity['providerUtilization']['items'][number]>[] = [
    { key: 'providerId', header: t('capacityProvider'), cell: (row) => row.providerId },
    {
      key: 'completedAppointments',
      header: t('capacityCompleted'),
      numeric: true,
      cell: (row) => new Intl.NumberFormat(locale).format(row.completedAppointments),
    },
    {
      key: 'scheduledNonCancelled',
      header: t('capacityScheduled'),
      numeric: true,
      cell: (row) => new Intl.NumberFormat(locale).format(row.scheduledNonCancelled),
    },
    { key: 'percent', header: t('capacityFill'), numeric: true, cell: (row) => formatPercent(row.percent) },
  ];

  return (
    <>
      {capacity.interpretation ? (
        <p className="text-caption text-tertiary">{capacity.interpretation}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-body font-semibold text-primary">{t('capacityPeaksHeading')}</h3>
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
            <div className="flex flex-col gap-1">
              <h4 className="text-caption text-tertiary">{t('capacityPeakHours')}</h4>
              <ul className="flex flex-col gap-0.5 text-meta text-primary">
                {capacity.peakHours.map((peak) => (
                  <li key={peak.label} className="flex items-baseline justify-between gap-4">
                    <span className="tabular-nums">{peak.label}</span>
                    <span className="tabular-nums">{new Intl.NumberFormat(locale).format(peak.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-1">
              <h4 className="text-caption text-tertiary">{t('capacityPeakDays')}</h4>
              <ul className="flex flex-col gap-0.5 text-meta text-primary">
                {capacity.peakDays.map((peak) => (
                  <li key={peak.label} className="flex items-baseline justify-between gap-4">
                    <span>{peak.label}</span>
                    <span className="tabular-nums">{new Intl.NumberFormat(locale).format(peak.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-body font-semibold text-primary">{t('capacityDepartmentHeading')}</h3>
          <p className="text-caption text-tertiary">{capacity.departmentLoad.label}</p>
          <p className="text-meta text-secondary">
            {t('capacityDepartmentTotal', {
              total: new Intl.NumberFormat(locale).format(capacity.departmentLoad.total),
            })}
          </p>
          <ul className="flex flex-col gap-0.5 text-meta text-primary">
            {capacity.departmentLoad.items.map((item) => (
              <li key={item.departmentId} className="flex items-baseline justify-between gap-4">
                <span>{item.departmentId}</span>
                <span className="tabular-nums">{new Intl.NumberFormat(locale).format(item.tickets)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 lg:col-span-2">
          <h3 className="text-body font-semibold text-primary">{t('capacityProviderHeading')}</h3>
          <p className="text-caption text-tertiary">{capacity.providerUtilization.label}</p>
          <DataTable
            caption={t('capacityProviderCaption')}
            columns={providerColumns}
            rows={capacity.providerUtilization.items}
            rowKey={(row) => row.providerId}
            emptyMessage={t('capacityEmpty')}
            scrollable
          />
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-body font-semibold text-primary">{t('capacityBedsHeading')}</h3>
          <p className="text-caption text-tertiary">{capacity.bedOccupancy.label}</p>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-meta text-primary">
            <div className="flex gap-1">
              <dt className="text-tertiary">{t('capacityBedsOccupied')}</dt>
              <dd className="tabular-nums">
                {new Intl.NumberFormat(locale).format(capacity.bedOccupancy.occupied)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-tertiary">{t('capacityBedsTotal')}</dt>
              <dd className="tabular-nums">
                {new Intl.NumberFormat(locale).format(capacity.bedOccupancy.total)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-tertiary">{t('capacityBedsPercent')}</dt>
              <dd className="tabular-nums">{formatPercent(capacity.bedOccupancy.percent)}</dd>
            </div>
          </dl>
          <h4 className="text-caption text-tertiary">{t('capacityAdmissions')}</h4>
          <ul className="flex flex-col gap-0.5 text-meta text-primary">
            {capacity.bedOccupancy.admissionsPerDay.map((day) => (
              <li key={day.date} className="flex items-baseline justify-between gap-4">
                <span>{formatDate(day.date)}</span>
                <span className="tabular-nums">{new Intl.NumberFormat(locale).format(day.admissions)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-body font-semibold text-primary">{t('capacityForecastHeading')}</h3>
          {capacity.appointmentDemand.forecast ? (
            <ForecastBlock
              forecast={capacity.appointmentDemand.forecast}
              label={capacity.appointmentDemand.label}
              locale={locale}
            />
          ) : (
            <p className="text-meta text-secondary">{t('capacityForecastUnavailable')}</p>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * A labelled forecast. The model name and version, the fit period, the horizon,
 * the points with their uncertainty band, and the service's own notes are all
 * shown — a forecast is an estimate, and stripping the band or the caveats is how
 * it gets read as a promise.
 */
function ForecastBlock({
  forecast,
  label,
  locale,
}: {
  forecast: ForecastResult;
  label: string;
  locale: string;
}) {
  const t = useTranslations('analytics');
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(date.length > 10 ? date : `${date}T00:00:00Z`),
    );
  const number = (value: number | null) =>
    value === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);

  const columns: readonly DataTableColumn<ForecastResult['points'][number]>[] = [
    { key: 'date', header: t('forecastDate'), cell: (row) => formatDate(row.date) },
    { key: 'value', header: t('forecastValue'), numeric: true, cell: (row) => number(row.value) },
    { key: 'lower', header: t('forecastLower'), numeric: true, cell: (row) => number(row.lower) },
    { key: 'upper', header: t('forecastUpper'), numeric: true, cell: (row) => number(row.upper) },
  ];

  return (
    <div className="flex flex-col gap-2">
      {label ? <p className="text-caption text-tertiary">{label}</p> : null}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-meta text-primary">
        <div className="flex gap-1">
          <dt className="text-tertiary">{t('forecastModel')}</dt>
          <dd>{`${forecast.model.name} v${forecast.model.version}`}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-tertiary">{t('forecastFit')}</dt>
          <dd>
            {t('forecastFitValue', {
              from: formatDate(forecast.period.from),
              to: formatDate(forecast.period.to),
            })}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-tertiary">{t('forecastHorizon')}</dt>
          <dd className="tabular-nums">{forecast.horizon}</dd>
        </div>
      </dl>
      <DataTable
        caption={t('forecastCaption')}
        columns={columns}
        rows={forecast.points}
        rowKey={(row) => row.date}
        emptyMessage={t('forecastEmpty')}
      />
      {forecast.notes.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-caption text-tertiary">
          {forecast.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
