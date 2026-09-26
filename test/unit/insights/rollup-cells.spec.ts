import {
  addUTCDays,
  averageOf,
  businessDay,
  cellKeyOf,
  cellKeyParts,
  eachDay,
  emptyCounters,
  rateOf,
} from '../../../src/modules/insights/domain/rollup-cells';

describe('cellKeyOf / cellKeyParts', () => {
  it('round-trips scoped and unscoped keys', () => {
    expect(cellKeyParts(cellKeyOf('b1', 'd2'))).toEqual({ branchId: 'b1', departmentId: 'd2' });
    expect(cellKeyParts(cellKeyOf('', ''))).toEqual({ branchId: '', departmentId: '' });
    expect(cellKeyOf('', '')).toBe('\u0000');
  });
});

describe('businessDay / addUTCDays', () => {
  it('truncates to UTC midnight', () => {
    const d = new Date('2026-09-26T18:34:00.000Z');
    expect(businessDay(d).toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });

  it('adds days across month boundaries', () => {
    const d = new Date('2026-09-30T00:00:00.000Z');
    expect(addUTCDays(d, 1).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(addUTCDays(d, -30).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});

describe('eachDay', () => {
  it('yields every day inclusive of the end', () => {
    const days = [...eachDay(new Date('2026-09-01T10:00:00.000Z'), new Date('2026-09-05T02:00:00.000Z'))];
    expect(days).toHaveLength(5);
    expect(days[0]!.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(days[4]!.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });
});

describe('rateOf / averageOf', () => {
  it('returns null when the denominator is empty', () => {
    expect(rateOf(0, 0)).toBeNull();
    expect(averageOf(0, 0)).toBeNull();
  });

  it('rounds percentages to one decimal', () => {
    expect(rateOf(3, 7)).toBe(42.9);
  });

  it('rounds averages to two decimals', () => {
    expect(averageOf(10, 3)).toBe(3.33);
  });
});

describe('emptyCounters', () => {
  it('starts every counter at zero and sums at "0.00"', () => {
    const c = emptyCounters();
    expect(c.visitsRegistered).toBe(0);
    expect(c.paymentsTotal).toBe('0.00');
    expect(c.waitMinutes).toBe('0.00');
    expect(c.feedbackRatingSum).toBe(0);
  });
});