'use client';

import { FlaskConical, ScanLine } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { useLabOrder, useLabOrders, useLabTests, useRadiologyOrders } from '@/lib/data/queries';
import {
  LAB_RESULT_STATUSES,
  type LabOrderPriority,
  type LabOrderStatus,
  type LabOrderSummaryRow,
  type LabResultRow,
  type LabTestRow,
} from '@/lib/data/laboratory';
import {
  RADIOLOGY_REPORT_STATUSES,
  type RadiologyOrderRow,
  type RadiologyStatus,
} from '@/lib/data/radiology';

/**
 * Results panel (F4 — doctor results view).
 *
 * Read-only. The doctor sees what the laboratory and radiology modules have
 * released for this patient; ordering and processing are those modules' work
 * (F5). Two sources, two shapes:
 *
 *  - Laboratory: the list is a thin projection (no results, no test names), so
 *    an order that carries results is fetched by id. A result names its analyte
 *    only by `testFieldId`, so the test catalog supplies name/unit/reference.
 *  - Imaging: the list already serializes each report, so no follow-up read.
 *
 * Nothing here is interactive, so there is no optimistic state to reconcile —
 * abnormal and critical flags are status pills (a word, a shape, and colour),
 * never a colour-only cue.
 */

interface FieldMeta {
  name: string;
  unit: string | null;
  referenceMin: string | null;
  referenceMax: string | null;
}

type FieldIndex = ReadonlyMap<string, FieldMeta>;

const LAB_TONE: Record<LabOrderStatus, StatusTone> = {
  ORDERED: 'neutral',
  COLLECTED: 'info',
  RECEIVED: 'info',
  PROCESSING: 'warning',
  RESULT_READY: 'info',
  VERIFIED: 'info',
  RELEASED: 'success',
  REJECTED: 'critical',
  CANCELLED: 'neutral',
};

const RADIOLOGY_TONE: Record<RadiologyStatus, StatusTone> = {
  ORDERED: 'neutral',
  SCHEDULED: 'info',
  PERFORMED: 'info',
  REPORTED: 'info',
  VERIFIED: 'info',
  RELEASED: 'success',
  CANCELLED: 'neutral',
};

const PRIORITY_TONE: Record<LabOrderPriority, StatusTone> = {
  ROUTINE: 'neutral',
  URGENT: 'warning',
  STAT: 'critical',
};

function buildFieldIndex(tests: readonly LabTestRow[]): FieldIndex {
  const index = new Map<string, FieldMeta>();
  for (const test of tests) {
    for (const field of test.fields) {
      index.set(field.id, {
        name: field.name,
        unit: field.unit,
        referenceMin: field.referenceMin,
        referenceMax: field.referenceMax,
      });
    }
  }
  return index;
}

function referenceRange(meta: FieldMeta): string | null {
  if (meta.referenceMin && meta.referenceMax) return `${meta.referenceMin}–${meta.referenceMax}`;
  if (meta.referenceMin) return `≥ ${meta.referenceMin}`;
  if (meta.referenceMax) return `\u2264 ${meta.referenceMax}`;
  return null;
}

export function ResultsPanel({ patientId }: { patientId: string }) {
  const t = useTranslations('results');
  const lab = useLabOrders({ patientId });
  const imaging = useRadiologyOrders({ patientId });
  const catalog = useLabTests({ active: 'true' });

  const fieldIndex = useMemo<FieldIndex>(
    () => buildFieldIndex(catalog.data?.data.items ?? []),
    [catalog.data],
  );

  const labRows = lab.data?.data.items ?? [];
  const imagingRows = imaging.data?.data.items ?? [];
  const resultOrders = labRows.filter((row) => LAB_RESULT_STATUSES.includes(row.status));
  const pendingLab = labRows.filter((row) => !LAB_RESULT_STATUSES.includes(row.status));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-subheading font-semibold text-primary">{t('title')}</h2>
      <p className="max-w-prose text-meta text-secondary">{t('intro')}</p>

      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-body font-semibold text-primary">
          <FlaskConical aria-hidden className="size-4 shrink-0 text-tertiary" strokeWidth={1.5} />
          {t('laboratory.heading')}
        </h3>

        {lab.isLoading && labRows.length === 0 ? (
          <p role="status" className="text-meta text-tertiary">
            {t('loading')}
          </p>
        ) : lab.error ? (
          <EmptyState
            title={t('unavailableTitle')}
            description={t('unavailableBody')}
            icon={FlaskConical}
            headingLevel={3}
          />
        ) : labRows.length === 0 ? (
          <EmptyState title={t('laboratory.empty')} headingLevel={3} />
        ) : (
          <div className="flex flex-col gap-3">
            {resultOrders.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {resultOrders.map((order) => (
                  <li key={order.id}>
                    <LabResultCard order={order} fieldIndex={fieldIndex} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta text-secondary">{t('laboratory.noResults')}</p>
            )}

            {pendingLab.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h4 className="text-meta font-medium text-secondary">{t('laboratory.pending')}</h4>
                <ul className="flex flex-col gap-2">
                  {pendingLab.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2"
                    >
                      <span className="text-meta text-secondary">
                        {t('laboratory.orderNumber', { number: row.orderNumber })}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          size="sm"
                          tone={LAB_TONE[row.status]}
                          label={t(`status.${row.status}`)}
                        />
                        <StatusPill
                          size="sm"
                          tone={PRIORITY_TONE[row.priority]}
                          label={t(`priority.${row.priority}`)}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-body font-semibold text-primary">
          <ScanLine aria-hidden className="size-4 shrink-0 text-tertiary" strokeWidth={1.5} />
          {t('imaging.heading')}
        </h3>

        {imaging.isLoading && imagingRows.length === 0 ? (
          <p role="status" className="text-meta text-tertiary">
            {t('loading')}
          </p>
        ) : imaging.error ? (
          <EmptyState
            title={t('unavailableTitle')}
            description={t('unavailableBody')}
            icon={ScanLine}
            headingLevel={3}
          />
        ) : imagingRows.length === 0 ? (
          <EmptyState title={t('imaging.empty')} headingLevel={3} />
        ) : (
          <ul className="flex flex-col gap-3">
            {imagingRows.map((order) => (
              <li key={order.id}>
                <RadiologyCard order={order} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LabResultCard({ order, fieldIndex }: { order: LabOrderSummaryRow; fieldIndex: FieldIndex }) {
  const t = useTranslations('results');
  const locale = useLocale();
  const detail = useLabOrder(order.id);
  const row = detail.data?.data;

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="text-meta font-semibold text-primary">
          {t('laboratory.orderNumber', { number: order.orderNumber })}
        </h4>
        <StatusPill size="sm" tone={LAB_TONE[order.status]} label={t(`status.${order.status}`)} />
        <StatusPill
          size="sm"
          tone={PRIORITY_TONE[order.priority]}
          label={t(`priority.${order.priority}`)}
        />
      </header>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-tertiary">
        {order.orderedAt ? <span>{t('laboratory.ordered', { date: format(order.orderedAt) })}</span> : null}
        {order.releasedAt ? <span>{t('laboratory.released', { date: format(order.releasedAt) })}</span> : null}
      </div>

      {detail.isLoading && !row ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : detail.error || !row ? (
        <p className="text-meta text-secondary">{t('laboratory.detailUnavailable')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {row.items.map((item) => (
            <section key={item.id} className="flex flex-col gap-2">
              <h5 className="text-meta font-semibold text-primary">
                {item.testName || item.testCode}
              </h5>
              {item.results.length === 0 ? (
                <p className="text-meta text-tertiary">{t('laboratory.noValues')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {item.results.map((result) => (
                    <li key={result.id}>
                      <LabResultLine result={result} meta={fieldIndex.get(result.testFieldId) ?? null} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function LabResultLine({ result, meta }: { result: LabResultRow; meta: FieldMeta | null }) {
  const t = useTranslations('results');
  const value = meta?.unit ? `${result.value} ${meta.unit}` : result.value;
  const range = meta ? referenceRange(meta) : null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-meta text-secondary">{meta?.name ?? result.testFieldId}</span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-meta font-medium tabular-nums text-primary">{value}</span>
        {range ? (
          <span className="text-caption tabular-nums text-tertiary">
            {t('laboratory.reference', { range })}
          </span>
        ) : null}
        {result.isCritical ? (
          <StatusPill size="sm" tone="critical" label={t('flag.critical')} />
        ) : result.isAbnormal ? (
          <StatusPill size="sm" tone="warning" label={t('flag.abnormal')} />
        ) : null}
      </span>
    </div>
  );
}

function RadiologyCard({ order }: { order: RadiologyOrderRow }) {
  const t = useTranslations('results');
  const locale = useLocale();
  const report = order.report;

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="text-meta font-semibold text-primary">
          {t(`modality.${order.modality}`)}
          {order.region ? ` — ${order.region}` : ''}
        </h4>
        <StatusPill
          size="sm"
          tone={RADIOLOGY_TONE[order.status]}
          label={t(`status.${order.status}`)}
        />
        <span className="text-caption text-tertiary">
          {t('imaging.orderNumber', { number: order.orderNumber })}
        </span>
      </header>

      {report ? (
        <dl className="flex flex-col gap-2 text-meta">
          {report.impression ? (
            <div>
              <dt className="font-medium text-secondary">{t('imaging.impression')}</dt>
              <dd className="text-primary">{report.impression}</dd>
            </div>
          ) : null}
          {report.findings ? (
            <div>
              <dt className="font-medium text-secondary">{t('imaging.findings')}</dt>
              <dd className="text-primary">{report.findings}</dd>
            </div>
          ) : null}
          {report.summary ? (
            <div>
              <dt className="font-medium text-secondary">{t('imaging.summary')}</dt>
              <dd className="text-primary">{report.summary}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-meta text-tertiary">
          {RADIOLOGY_REPORT_STATUSES.includes(order.status)
            ? t('imaging.reportPending')
            : t('imaging.awaitingReport')}
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-tertiary">
        {order.orderedAt ? <span>{t('imaging.ordered', { date: format(order.orderedAt) })}</span> : null}
        {order.performedAt ? (
          <span>{t('imaging.performed', { date: format(order.performedAt) })}</span>
        ) : null}
        {order.releasedAt ? <span>{t('imaging.released', { date: format(order.releasedAt) })}</span> : null}
      </div>
    </article>
  );
}
