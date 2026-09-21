import {
  parseSort,
  paginate,
  toPageMeta,
  pageOf,
  isPageResult,
  MAX_LIMIT,
  parseDateRange,
} from '../../src/common/pagination/pagination';
import { AppError } from '../../src/common/errors/app-error';

describe('paginate', () => {
  it('uses defaults', () => {
    expect(paginate({})).toEqual({ page: 1, limit: 20 });
  });

  it('clamps limit to MAX_LIMIT', () => {
    expect(paginate({ limit: 10_000 }).limit).toBe(MAX_LIMIT);
  });

  it('falls back to defaults on garbage input', () => {
    expect(paginate({ page: -3, limit: 0 })).toEqual({ page: 1, limit: 20 });
    expect(paginate({ page: 2.5, limit: 5.5 })).toEqual({ page: 1, limit: 20 });
  });
});

describe('toPageMeta / pageOf', () => {
  it('computes totalPages correctly', () => {
    expect(toPageMeta(0, 1, 20).totalPages).toBe(0);
    expect(toPageMeta(20, 1, 20).totalPages).toBe(1);
    expect(toPageMeta(21, 1, 20).totalPages).toBe(2);
  });

  it('builds a page result recognized by isPageResult', () => {
    const result = pageOf(['a', 'b'], 2, 1, 20);
    expect(isPageResult(result)).toBe(true);
    expect(isPageResult('nope')).toBe(false);
    expect(isPageResult(null)).toBe(false);
  });
});

describe('parseSort', () => {
  const ALLOW = ['name', 'createdAt'] as const;

  it('accepts allowlisted fields with direction', () => {
    expect(parseSort('name', ALLOW)).toEqual({ field: 'name', dir: 'asc' });
    expect(parseSort('-createdAt', ALLOW)).toEqual({ field: 'createdAt', dir: 'desc' });
  });

  it('returns null on missing sort', () => {
    expect(parseSort(undefined, ALLOW)).toBeNull();
    expect(parseSort('', ALLOW)).toBeNull();
  });

  it('rejects non-allowlisted columns', () => {
    expect(() => parseSort('id', ALLOW)).toThrow(AppError);
    expect(() => parseSort('-drop_table', ALLOW)).toThrow(AppError);
  });
});

describe('parseDateRange', () => {
  it('accepts dates within the span', () => {
    const range = parseDateRange('2026-01-01', '2026-01-31');
    expect(range.from).not.toBeNull();
    expect(range.to).not.toBeNull();
  });

  it('rejects invalid dates', () => {
    expect(() => parseDateRange('not-a-date', undefined)).toThrow(AppError);
  });

  it('rejects inverted ranges', () => {
    expect(() => parseDateRange('2026-02-01', '2026-01-01')).toThrow(AppError);
  });

  it('rejects spans longer than maxSpanDays', () => {
    expect(() => parseDateRange('2025-01-01', '2026-01-01', 30)).toThrow(AppError);
  });
});
