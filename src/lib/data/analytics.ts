import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableNumber,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Analytics metrics (F10 analytics & reports).
 *
 * `GET /analytics/metrics` is typed `unknown` in the export (the response is a
 * large, nested object carrying `@example` shapes only), so the body rides the
 * raw-fetch path and is validated structurally. The two critical parts — the
 * daily series and the headline summary — fail closed on drift; the point-in-time
 * `snapshots` block is deliberately left loose and rendered generically, because
 * it is an open set of labelled measurements that the API adds to over time and a
 * new block should appear on the dashboard rather than blank it.
 *
 * The service labels every measurement in its own words (`label` on each
 * snapshot, a top-level `label` for the whole payload). Those strings are
 * surfaced verbatim; they are the honest boundary between a measurement and a
 * claim, and paraphrasing them here would let the two drift.
 */

export type AnalyticsCallError = EnvelopeCallError;

export interface MetricsScope {
  readonly branchId: string | null;
  readonly departmentId: string | null;
}

export interface MetricsPeriod {
  readonly from: string;
  readonly to: string;
}

/** One day of the rollup series. Money stays a decimal string (ADR-029). */
export interface MetricsSeriesRow {
  readonly date: string;
  readonly patientVolume: number;
  readonly appointmentVolume: number;
  readonly noShowRate: number | null;
  readonly cancellationRate: number | null;
  readonly rescheduleRate: number | null;
  readonly avgWaitingMinutes: number | null;
  readonly avgConsultationMinutes: number | null;
  readonly revenue: string;
  readonly invoicesIssued: number;
  readonly invoicesTotal: string;
  readonly refundsTotal: string;
  readonly labTatAvgMinutes: number | null;
  readonly admissions: number;
  readonly discharges: number;
  readonly emergencyArrivals: number;
  readonly feedbackSubmitted: number;
}

/** The headline summary: counts and rates are numbers, money is a decimal string. */
export type MetricsSummary = Readonly<Record<string, number | string | null>>;

export interface AnalyticsMetrics {
  readonly scope: MetricsScope;
  readonly period: MetricsPeriod;
  readonly granularity: string;
  readonly series: readonly MetricsSeriesRow[];
  readonly summary: MetricsSummary;
  readonly snapshots: Readonly<Record<string, unknown>>;
  readonly label: string;
}

export interface AnalyticsMetricsQuery {
  readonly from?: string;
  readonly to?: string;
  readonly granularity?: 'day' | 'week';
  readonly branchId?: string;
  readonly departmentId?: string;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Money is a decimal string on the wire; a numeric body is coerced without arithmetic. */
function money(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '0.00';
}

function readSeriesRow(value: unknown): MetricsSeriesRow | null {
  if (!isRecord(value) || typeof value.date !== 'string') return null;
  return {
    date: value.date,
    patientVolume: count(value.patientVolume),
    appointmentVolume: count(value.appointmentVolume),
    noShowRate: nullableNumber(value.noShowRate),
    cancellationRate: nullableNumber(value.cancellationRate),
    rescheduleRate: nullableNumber(value.rescheduleRate),
    avgWaitingMinutes: nullableNumber(value.avgWaitingMinutes),
    avgConsultationMinutes: nullableNumber(value.avgConsultationMinutes),
    revenue: money(value.revenue),
    invoicesIssued: count(value.invoicesIssued),
    invoicesTotal: money(value.invoicesTotal),
    refundsTotal: money(value.refundsTotal),
    labTatAvgMinutes: nullableNumber(value.labTatAvgMinutes),
    admissions: count(value.admissions),
    discharges: count(value.discharges),
    emergencyArrivals: count(value.emergencyArrivals),
    feedbackSubmitted: count(value.feedbackSubmitted),
  };
}

/** Keeps the flat scalar members of the summary; a nested value would be drift and is dropped. */
function readSummary(value: unknown): MetricsSummary | null {
  if (!isRecord(value)) return null;
  const summary: Record<string, number | string | null> = {};
  for (const [key, member] of Object.entries(value)) {
    if (member === null || typeof member === 'number' || typeof member === 'string') {
      summary[key] = member;
    }
  }
  return summary;
}

/** Validate the unwrapped `data`: series and summary fail closed, snapshots stay loose. */
export function readAnalyticsMetrics(data: unknown): AnalyticsMetrics | null {
  if (!isRecord(data)) return null;

  const period = isRecord(data.period) ? data.period : null;
  if (!period || typeof period.from !== 'string' || typeof period.to !== 'string') return null;

  const summary = readSummary(data.summary);
  if (!summary) return null;

  if (!Array.isArray(data.series)) return null;
  const rows = data.series.map(readSeriesRow);
  if (rows.some((row) => row === null)) return null;

  const scope = isRecord(data.scope) ? data.scope : {};

  return {
    scope: {
      branchId: typeof scope.branchId === 'string' ? scope.branchId : null,
      departmentId: typeof scope.departmentId === 'string' ? scope.departmentId : null,
    },
    period: { from: period.from, to: period.to },
    granularity: typeof data.granularity === 'string' ? data.granularity : 'day',
    series: rows as readonly MetricsSeriesRow[],
    summary,
    snapshots: isRecord(data.snapshots) ? data.snapshots : {},
    label: typeof data.label === 'string' ? data.label : '',
  };
}

/** Raw read against `GET /analytics/metrics?{window}`. Windows default on the service. */
export async function fetchAnalyticsMetrics(
  query: AnalyticsMetricsQuery = {},
  signal?: AbortSignal,
): Promise<AnalyticsMetrics> {
  const suffix = queryString({
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    branchId: query.branchId,
    departmentId: query.departmentId,
  });
  const url = `${publicEnv.apiBasePath}/analytics/metrics${suffix}`;
  return readEnvelope<AnalyticsMetrics>(
    url,
    (data) => {
      const metrics = readAnalyticsMetrics(data);
      return metrics ? { ok: true, value: metrics } : { ok: false };
    },
    signal,
  );
}
