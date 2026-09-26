/**
 * Brief Phase 11 — forecasting architecture (repo Phase 13). A Forecaster is a
 * statistical baseline over a numeric time series; there is no ML or claims of
 * causal accuracy. Every result carries the model name/version, the data
 * period it was fit on, and an uncertainty band derived from the residuals of
 * the fit against history. Consumers must label responses as forecasts /
 * estimates before they leave the API (see forecasts.service).
 */

export interface ForecastValues {
  values: number[];
  /** Symmetric uncertainty band (units of the series). */
  lower: number[];
  upper: number[];
}

export interface ForecastPoint {
  /** ISO date of the forecast day (the next data point after history). */
  date: string;
  value: number;
  lower?: number;
  upper?: number;
}

export interface ForecastResult {
  kind: 'forecast';
  model: { name: string; version: string };
  /** The calendar dates the history series covered. */
  period: { from: string; to: string };
  horizon: number;
  points: ForecastPoint[];
  notes: string[];
}

export interface Forecaster {
  name: string;
  version: string;
  forecast(history: number[], horizon: number): ForecastValues;
}

const meanOf = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const stddevOf = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
};

/** Standard deviation of (actual - fitted) using the same model over history. */
function fittedResidualStddev(args: {
  history: number[];
  predictForEach: (windowEnd: number) => ForecastValues;
}): number {
  const { history, predictForEach } = args;
  const residuals: number[] = [];
  const horizonSample = 1;
  for (let end = 2; end < history.length; end += 1) {
    const fit = predictForEach(end);
    for (let h = 0; h < Math.min(horizonSample, fit.values.length); h += 1) {
      const actual = history[end + h];
      const predicted = fit.values[h];
      if (actual !== undefined && predicted !== undefined) {
        residuals.push(actual - predicted);
      }
    }
  }
  return residuals.length >= 2 ? stddevOf(residuals) : stddevOf(history);
}

/** Simple trailing-window mean. Defaults to a 7-day window. */
export function movingAverageForecaster(window = 7): Forecaster {
  return {
    name: 'moving-average',
    version: '1.0.0',
    forecast(history, horizon) {
      const values: number[] = [];
      for (let i = 0; i < horizon; i += 1) {
        const windowEnd = history.length + i;
        const prefix = history.slice(Math.max(0, windowEnd - window), history.length + i);
        values.push(meanOf(prefix));
      }
      const sigma = fittedResidualStddev({
        history,
        predictForEach: (end) => {
          const prefix = history.slice(Math.max(0, end - window), end);
          return { values: [meanOf(prefix)], lower: [0], upper: [0] };
        },
      });
      const band = Math.max(0.001, sigma * 1.96);
      return {
        values,
        lower: values.map((v) => Math.max(0, v - band)),
        upper: values.map((v) => v + band),
      };
    },
  };
}

/**
 * Weekly seasonal naive: today's forecast repeats the same weekday's value one
 * period back (seasonal naive). Values cycle through the last week of history;
 * the model degrades into the moving average when history is too short.
 */
export function seasonalNaiveForecaster(period = 7, fallbackWindow = 3): Forecaster {
  return {
    name: 'seasonal-naive',
    version: '1.0.0',
    forecast(history, horizon) {
      const values: number[] = [];
      for (let i = 0; i < horizon; i += 1) {
        const lead = i % period;
        const sourceIndex = history.length - period + lead;
        if (history.length >= period && sourceIndex >= 0) {
          const value = history[sourceIndex];
          const fallback = meanOf(history.slice(Math.max(0, history.length - fallbackWindow)));
          values.push(value === undefined ? fallback : value);
        } else {
          const prefix = history.slice(Math.max(0, history.length - fallbackWindow));
          values.push(meanOf(prefix));
        }
      }
      const sigma = fittedResidualStddev({
        history,
        predictForEach: (end) => {
          if (end < period) {
            const mean = meanOf(history.slice(0, end));
            return { values: [mean], lower: [0], upper: [0] };
          }
          const value = history[end - period];
          const mean = meanOf(history.slice(0, end));
          return { values: [value === undefined ? mean : value], lower: [0], upper: [0] };
        },
      });
      const band = Math.max(0.001, sigma * 1.96);
      return {
        values,
        lower: values.map((v) => Math.max(0, v - band)),
        upper: values.map((v) => v + band),
      };
    },
  };
}

export const DEFAULT_FORECASTER: Forecaster = seasonalNaiveForecaster(7, 3);

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Batch a daily series into a ForecastResult. `points` carry the model's
 * period, labels and uncertainty; callers add domain notes on top.
 */
export function toForecastResult(args: {
  forecaster: Forecaster;
  start: Date;
  history: number[];
  horizon: number;
  notes?: string[];
}): ForecastResult {
  const { forecaster, start, history, horizon } = args;
  const fitted = forecaster.forecast(history, horizon);
  const origin = new Date(start);
  const points: ForecastPoint[] = fitted.values.map((value, i) => {
    const date = new Date(origin);
    date.setUTCDate(origin.getUTCDate() + history.length + i);
    const lower = fitted.lower[i];
    const upper = fitted.upper[i];
    return {
      date: toDateKey(date),
      value: Math.round(value * 100) / 100,
      lower: lower === undefined ? undefined : Math.round(lower * 100) / 100,
      upper: upper === undefined ? undefined : Math.round(upper * 100) / 100,
    };
  });
  const from = new Date(origin);
  from.setUTCDate(origin.getUTCDate());
  const to = new Date(origin);
  to.setUTCDate(origin.getUTCDate() + history.length - 1);
  return {
    kind: 'forecast',
    model: { name: forecaster.name, version: forecaster.version },
    period: { from: toDateKey(from), to: toDateKey(to) },
    horizon,
    points,
    notes: [
      'Statistical baseline only; forecast/estimate, not a promise.',
      `Fit on ${history.length} data points (${toDateKey(from)}..${toDateKey(to)}).`,
      'Uncertainty band from model residuals over history.',
      ...(args.notes ?? []),
    ],
  };
}