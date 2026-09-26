import {
  movingAverageForecaster,
  seasonalNaiveForecaster,
  toForecastResult,
} from '../../../src/modules/insights/domain/forecaster';

describe('movingAverageForecaster', () => {
  it('repeats the trailing mean for a flat history', () => {
    const f = movingAverageForecaster(7);
    const { values } = f.forecast([10, 10, 10, 10, 10, 10], 3);
    expect(values).toHaveLength(3);
    expect(Math.abs(values[0]! - 10)).toBeLessThan(1e-9);
  });

  it('produces a symmetric band around the point estimate', () => {
    const f = movingAverageForecaster(3);
    const { values, lower, upper } = f.forecast([1, 2, 3, 4, 5, 6, 7, 8], 4);
    values.forEach((v, i) => {
      expect(lower[i]).toBeDefined();
      expect(upper[i]).toBeDefined();
      expect(lower[i]! <= v).toBe(true);
      expect(upper[i]! >= v).toBe(true);
      expect(lower[i]! <= upper[i]!).toBe(true);
    });
  });

  it('does not forecast below zero', () => {
    const f = movingAverageForecaster(2);
    const { lower } = f.forecast([0, 0, 0], 3);
    expect(lower.every((v) => v >= 0)).toBe(true);
  });
});

describe('seasonalNaiveForecaster', () => {
  it('repeats the weekday pattern once the period is available', () => {
    const f = seasonalNaiveForecaster(7, 3);
    const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const { values } = f.forecast(history, 14);
    for (let i = 0; i < 14; i += 1) {
      expect(values[i]).toBeCloseTo(history[7 + (i % 7)]!, 9);
    }
  });

  it('degrades to the fallback mean when history is shorter than the period', () => {
    const f = seasonalNaiveForecaster(7, 3);
    const { values } = f.forecast([5, 6, 7], 4);
    const fallback = 6;
    values.forEach((v) => expect(v).toBeCloseTo(fallback, 9));
  });

  it('keeps band bounds coherent for short histories', () => {
    const f = seasonalNaiveForecaster(7, 3);
    const { lower, upper } = f.forecast([5, 6, 7], 4);
    expect(lower.every((v, i) => v <= upper[i]! && v >= 0)).toBe(true);
  });
});

describe('toForecastResult', () => {
  const start = new Date('2026-09-01T00:00:00.000Z');

  it('emits horizon points dated after the history period', () => {
    const result = toForecastResult({
      forecaster: movingAverageForecaster(3),
      start,
      history: [1, 2, 3, 4, 5],
      horizon: 2,
    });
    expect(result.horizon).toBe(2);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.date).toBe('2026-09-06');
    expect(result.points[1]!.date).toBe('2026-09-07');
    expect(result.period.from).toBe('2026-09-01');
    expect(result.period.to).toBe('2026-09-05');
  });

  it('marks the output as a forecast with model metadata', () => {
    const result = toForecastResult({
      forecaster: seasonalNaiveForecaster(7, 3),
      start,
      history: [1, 2, 3, 4, 5, 6, 7],
      horizon: 1,
    });
    expect(result.kind).toBe('forecast');
    expect(result.model.name).toBe('seasonal-naive');
    expect(result.points[0]!.value).toBe(1);
    expect(result.notes.some((n) => n.toLowerCase().includes('estimate'))).toBe(true);
  });
});