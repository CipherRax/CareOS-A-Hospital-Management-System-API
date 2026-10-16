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

// --- bottleneck, capacity and forecast (F10 slice 3) ------------------------

/** One journey stage's timing. `medianMinutes` is null on a single sample. */
export interface BottleneckStage {
  readonly key: string;
  readonly label: string;
  readonly avgMinutes: number | null;
  readonly medianMinutes: number | null;
  readonly samples: number;
}

export interface AnalyticsBottleneck {
  readonly interpretation: string;
  readonly order: readonly string[];
  readonly stages: readonly BottleneckStage[];
  readonly period: MetricsPeriod;
}

/** A forecast point. `lower`/`upper` are omitted when the band is unavailable. */
export interface ForecastPoint {
  readonly date: string;
  readonly value: number;
  readonly lower: number | null;
  readonly upper: number | null;
}

/**
 * A labelled forecast: model name and version, the fitted period, a horizon, the
 * points, and the service's own caveats as `notes`. Every one of those is shown —
 * a forecast with its uncertainty band and its notes withheld is a promise.
 */
export interface ForecastResult {
  readonly kind: string;
  readonly model: { readonly name: string; readonly version: string };
  readonly period: { readonly from: string; readonly to: string };
  readonly horizon: number;
  readonly points: readonly ForecastPoint[];
  readonly notes: readonly string[];
}

export interface CapacityPeak {
  readonly label: string;
  readonly count: number;
}

export interface AnalyticsCapacity {
  readonly interpretation: string;
  readonly period: MetricsPeriod;
  readonly peakHours: readonly CapacityPeak[];
  readonly peakDays: readonly CapacityPeak[];
  readonly departmentLoad: {
    readonly total: number;
    readonly label: string;
    readonly items: readonly { readonly departmentId: string; readonly tickets: number }[];
  };
  readonly providerUtilization: {
    readonly label: string;
    readonly items: readonly {
      readonly providerId: string;
      readonly completedAppointments: number;
      readonly scheduledNonCancelled: number;
      readonly percent: number | null;
    }[];
  };
  readonly bedOccupancy: {
    readonly occupied: number;
    readonly total: number;
    readonly percent: number | null;
    readonly label: string;
    readonly admissionsPerDay: readonly { readonly date: string; readonly admissions: number }[];
  };
  readonly appointmentDemand: {
    readonly forecast: ForecastResult | null;
    readonly label: string;
  };
}

function readPeriod(value: unknown): MetricsPeriod | null {
  if (!isRecord(value) || typeof value.from !== 'string' || typeof value.to !== 'string') {
    return null;
  }
  return { from: value.from, to: value.to };
}

function readForecast(data: unknown): ForecastResult | null {
  if (!isRecord(data)) return null;
  const model = isRecord(data.model) ? data.model : null;
  const period = readPeriod(data.period);
  if (!model || typeof model.name !== 'string' || typeof model.version !== 'string' || !period) {
    return null;
  }
  if (!Array.isArray(data.points)) return null;
  const points = data.points.map((point): ForecastPoint | null => {
    if (!isRecord(point) || typeof point.date !== 'string') return null;
    return {
      date: point.date,
      value: typeof point.value === 'number' ? point.value : 0,
      lower: nullableNumber(point.lower),
      upper: nullableNumber(point.upper),
    };
  });
  if (points.some((point) => point === null)) return null;

  const notes = Array.isArray(data.notes) ? data.notes.filter((n): n is string => typeof n === 'string') : [];

  return {
    kind: typeof data.kind === 'string' ? data.kind : 'forecast',
    model: { name: model.name, version: model.version },
    period,
    horizon: typeof data.horizon === 'number' ? data.horizon : 0,
    points: points as readonly ForecastPoint[],
    notes,
  };
}

/**
 * Maps an array of unknown items, failing closed when any member is not an
 * object the mapper accepts.
 */
function readTypedItems<T>(
  value: unknown,
  map: (item: Record<string, unknown>) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const items = (value as unknown[]).map((item) => (isRecord(item) ? map(item) : null));
  return items.some((item) => item === null) ? null : (items as T[]);
}

/** Validates the unwrapped `GET /analytics/bottleneck` body; fails closed. */
export function readAnalyticsBottleneck(data: unknown): AnalyticsBottleneck | null {
  if (!isRecord(data)) return null;
  const period = readPeriod(data.period);
  if (!period) return null;
  if (!Array.isArray(data.stages)) return null;
  const stages = data.stages.map((stage): BottleneckStage | null => {
    if (!isRecord(stage) || typeof stage.key !== 'string' || typeof stage.label !== 'string') {
      return null;
    }
    return {
      key: stage.key,
      label: stage.label,
      avgMinutes: nullableNumber(stage.avgMinutes),
      medianMinutes: nullableNumber(stage.medianMinutes),
      samples: count(stage.samples),
    };
  });
  if (stages.some((stage) => stage === null)) return null;

  return {
    interpretation: typeof data.interpretation === 'string' ? data.interpretation : '',
    order: Array.isArray(data.order)
      ? data.order.filter((key): key is string => typeof key === 'string')
      : [],
    stages: stages as readonly BottleneckStage[],
    period,
  };
}

/** Validates the unwrapped `GET /analytics/capacity` body; fails closed. */
export function readAnalyticsCapacity(data: unknown): AnalyticsCapacity | null {
  if (!isRecord(data)) return null;
  const period = readPeriod(data.period);
  if (!period) return null;

  const readPeaks = (value: unknown): CapacityPeak[] | null => {
    if (!Array.isArray(value)) return null;
    const peaks = value.map((peak): CapacityPeak | null => {
      if (!isRecord(peak)) return null;
      const label = typeof peak.hour === 'string' ? peak.hour : typeof peak.day === 'string' ? peak.day : null;
      if (label === null) return null;
      return { label, count: count(peak.count) };
    });
    return peaks.some((peak) => peak === null) ? null : (peaks as CapacityPeak[]);
  };

  const peakHours = readPeaks(data.peakHours);
  const peakDays = readPeaks(data.peakDays);
  if (!peakHours || !peakDays) return null;

  const departmentLoad = isRecord(data.departmentLoad) ? data.departmentLoad : null;
  const providerUtilization = isRecord(data.providerUtilization) ? data.providerUtilization : null;
  const bedOccupancy = isRecord(data.bedOccupancy) ? data.bedOccupancy : null;
  const appointmentDemand = isRecord(data.appointmentDemand) ? data.appointmentDemand : null;
  if (!departmentLoad || !providerUtilization || !bedOccupancy || !appointmentDemand) return null;

  const departmentItems = readTypedItems<{ departmentId: string; tickets: number }>(
    departmentLoad.items,
    (item) =>
      typeof item.departmentId === 'string'
        ? { departmentId: item.departmentId, tickets: count(item.tickets) }
        : null,
  );
  const providerItems = readTypedItems<{
    providerId: string;
    completedAppointments: number;
    scheduledNonCancelled: number;
    percent: number | null;
  }>(providerUtilization.items, (item) =>
    typeof item.providerId === 'string'
      ? {
          providerId: item.providerId,
          completedAppointments: count(item.completedAppointments),
          scheduledNonCancelled: count(item.scheduledNonCancelled),
          percent: nullableNumber(item.percent),
        }
      : null,
  );
  const admissions = readTypedItems<{ date: string; admissions: number }>(
    bedOccupancy.admissionsPerDay,
    (item) =>
      typeof item.date === 'string'
        ? { date: item.date, admissions: count(item.admissions) }
        : null,
  );
  if (!departmentItems || !providerItems || !admissions) return null;

  return {
    interpretation: typeof data.interpretation === 'string' ? data.interpretation : '',
    period,
    peakHours,
    peakDays,
    departmentLoad: {
      total: count(departmentLoad.total),
      label: typeof departmentLoad.label === 'string' ? departmentLoad.label : '',
      items: departmentItems,
    },
    providerUtilization: {
      label: typeof providerUtilization.label === 'string' ? providerUtilization.label : '',
      items: providerItems,
    },
    bedOccupancy: {
      occupied: count(bedOccupancy.occupied),
      total: count(bedOccupancy.total),
      percent: nullableNumber(bedOccupancy.percent),
      label: typeof bedOccupancy.label === 'string' ? bedOccupancy.label : '',
      admissionsPerDay: admissions,
    },
    appointmentDemand: {
      forecast: readForecast(appointmentDemand.forecast),
      label: typeof appointmentDemand.label === 'string' ? appointmentDemand.label : '',
    },
  };
}

/** Raw read against `GET /analytics/bottleneck?{window}`. */
export async function fetchAnalyticsBottleneck(
  query: AnalyticsMetricsQuery = {},
  signal?: AbortSignal,
): Promise<AnalyticsBottleneck> {
  const suffix = queryString({
    from: query.from,
    to: query.to,
    branchId: query.branchId,
    departmentId: query.departmentId,
  });
  const url = `${publicEnv.apiBasePath}/analytics/bottleneck${suffix}`;
  return readEnvelope<AnalyticsBottleneck>(
    url,
    (data) => {
      const bottleneck = readAnalyticsBottleneck(data);
      return bottleneck ? { ok: true, value: bottleneck } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /analytics/capacity?{window}`. */
export async function fetchAnalyticsCapacity(
  query: AnalyticsMetricsQuery = {},
  signal?: AbortSignal,
): Promise<AnalyticsCapacity> {
  const suffix = queryString({
    from: query.from,
    to: query.to,
    branchId: query.branchId,
    departmentId: query.departmentId,
  });
  const url = `${publicEnv.apiBasePath}/analytics/capacity${suffix}`;
  return readEnvelope<AnalyticsCapacity>(
    url,
    (data) => {
      const capacity = readAnalyticsCapacity(data);
      return capacity ? { ok: true, value: capacity } : { ok: false };
    },
    signal,
  );
}

// --- forecasts, patient experience and staff analytics (F10 slice 4) -------

/** The forecast series the service knows. Anything else is echoed back with a note. */
export const FORECAST_SERIES = [
  'appointment-demand',
  'inventory-demand',
  'bed-occupancy',
  'lab-workload',
] as const;

export type ForecastSeries = (typeof FORECAST_SERIES)[number];

export interface AnalyticsForecastQuery extends AnalyticsMetricsQuery {
  /** Days ahead, 1–90. The service defaults to 7. */
  horizon?: number;
}

/** Validates the unwrapped `GET /analytics/forecasts/{series}` body. */
export function readAnalyticsForecast(data: unknown): ForecastResult | null {
  return readForecast(data);
}

export interface ExperienceComponent {
  readonly score: number | null;
  /** The measurements the component score was derived from, kept as labelled numbers. */
  readonly raw: Readonly<Record<string, number | null>>;
}

export interface ExperienceWeights {
  readonly waitingTime: number;
  readonly feedback: number;
  readonly appointmentReliability: number;
  readonly serviceCompletion: number;
}

export interface AnalyticsPatientExperience {
  readonly interpretation: string;
  readonly weights: ExperienceWeights;
  readonly components: {
    readonly waitingTime: ExperienceComponent;
    readonly feedback: ExperienceComponent;
    readonly appointmentReliability: ExperienceComponent;
    readonly serviceCompletion: ExperienceComponent;
  };
  readonly composite: number | null;
  readonly period: MetricsPeriod;
}

export interface StaffAnalyticRow {
  readonly staffId: string;
  readonly appointmentsHandled: number;
  readonly encountersOpened: number;
  readonly avgConsultationMinutes: number | null;
  readonly tasksCompleted: number;
  readonly queueServed: number;
}

export interface AnalyticsStaff {
  readonly interpretation: string;
  readonly period: MetricsPeriod;
  readonly items: readonly StaffAnalyticRow[];
}

function readExperienceComponent(value: unknown): ExperienceComponent | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.raw)) return null;
  const raw: Record<string, number | null> = {};
  for (const [key, member] of Object.entries(value.raw)) {
    if (typeof member === 'number') raw[key] = member;
    else if (member === null) raw[key] = null;
    else return null;
  }
  const score = value.score;
  if (score !== null && typeof score !== 'number') return null;
  return { score: typeof score === 'number' ? score : null, raw };
}

/** Validates the unwrapped `GET /analytics/patient-experience` body; fails closed. */
export function readAnalyticsPatientExperience(data: unknown): AnalyticsPatientExperience | null {
  if (!isRecord(data)) return null;
  const period = readPeriod(data.period);
  if (!period) return null;

  const weights = isRecord(data.weights) ? data.weights : null;
  if (
    !weights ||
    typeof weights.waitingTime !== 'number' ||
    typeof weights.feedback !== 'number' ||
    typeof weights.appointmentReliability !== 'number' ||
    typeof weights.serviceCompletion !== 'number'
  ) {
    return null;
  }

  const components = isRecord(data.components) ? data.components : null;
  if (!components) return null;
  const waitingTime = readExperienceComponent(components.waitingTime);
  const feedback = readExperienceComponent(components.feedback);
  const appointmentReliability = readExperienceComponent(components.appointmentReliability);
  const serviceCompletion = readExperienceComponent(components.serviceCompletion);
  if (!waitingTime || !feedback || !appointmentReliability || !serviceCompletion) return null;

  return {
    interpretation: typeof data.interpretation === 'string' ? data.interpretation : '',
    weights: {
      waitingTime: weights.waitingTime,
      feedback: weights.feedback,
      appointmentReliability: weights.appointmentReliability,
      serviceCompletion: weights.serviceCompletion,
    },
    components: { waitingTime, feedback, appointmentReliability, serviceCompletion },
    composite: nullableNumber(data.composite),
    period,
  };
}

/** Validates the unwrapped `GET /analytics/staff` body; fails closed. */
export function readAnalyticsStaff(data: unknown): AnalyticsStaff | null {
  if (!isRecord(data)) return null;
  const period = readPeriod(data.period);
  if (!period) return null;
  if (!Array.isArray(data.items)) return null;
  const items = data.items.map((item): StaffAnalyticRow | null => {
    if (!isRecord(item) || typeof item.staffId !== 'string') return null;
    return {
      staffId: item.staffId,
      appointmentsHandled: count(item.appointmentsHandled),
      encountersOpened: count(item.encountersOpened),
      avgConsultationMinutes: nullableNumber(item.avgConsultationMinutes),
      tasksCompleted: count(item.tasksCompleted),
      queueServed: count(item.queueServed),
    };
  });
  if (items.some((item) => item === null)) return null;

  return {
    interpretation: typeof data.interpretation === 'string' ? data.interpretation : '',
    period,
    items: items as readonly StaffAnalyticRow[],
  };
}

/** Raw read against `GET /analytics/forecasts/{series}?{window,horizon}`. */
export async function fetchAnalyticsForecast(
  series: string,
  query: AnalyticsForecastQuery = {},
  signal?: AbortSignal,
): Promise<ForecastResult> {
  const suffix = queryString({
    from: query.from,
    to: query.to,
    branchId: query.branchId,
    departmentId: query.departmentId,
    horizon: query.horizon === undefined ? undefined : String(query.horizon),
  });
  const url = `${publicEnv.apiBasePath}/analytics/forecasts/${encodeURIComponent(series)}${suffix}`;
  return readEnvelope<ForecastResult>(
    url,
    (data) => {
      const forecast = readAnalyticsForecast(data);
      return forecast ? { ok: true, value: forecast } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /analytics/patient-experience?{window}`. */
export async function fetchAnalyticsPatientExperience(
  query: AnalyticsMetricsQuery = {},
  signal?: AbortSignal,
): Promise<AnalyticsPatientExperience> {
  const suffix = queryString({
    from: query.from,
    to: query.to,
    branchId: query.branchId,
    departmentId: query.departmentId,
  });
  const url = `${publicEnv.apiBasePath}/analytics/patient-experience${suffix}`;
  return readEnvelope<AnalyticsPatientExperience>(
    url,
    (data) => {
      const experience = readAnalyticsPatientExperience(data);
      return experience ? { ok: true, value: experience } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /analytics/staff?{window,staffId}`. */
export async function fetchAnalyticsStaff(
  query: AnalyticsMetricsQuery = {},
  signal?: AbortSignal,
): Promise<AnalyticsStaff> {
  const suffix = queryString({
    from: query.from,
    to: query.to,
    branchId: query.branchId,
  });
  const url = `${publicEnv.apiBasePath}/analytics/staff${suffix}`;
  return readEnvelope<AnalyticsStaff>(
    url,
    (data) => {
      const staff = readAnalyticsStaff(data);
      return staff ? { ok: true, value: staff } : { ok: false };
    },
    signal,
  );
}
