import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PageResult<T> {
  items: T[];
  meta: PageMeta;
}

export interface PaginationInput {
  page?: number;
  limit?: number;
}

/** Normalises and clamps pagination. max limit enforced (100). */
export function paginate(input: PaginationInput): { page: number; limit: number } {
  const rawPage = input.page ?? DEFAULT_PAGE;
  const rawLimit = input.limit ?? DEFAULT_LIMIT;
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : DEFAULT_PAGE;
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;
  return { page, limit };
}

export function toPageMeta(total: number, page: number, limit: number): PageMeta {
  const totalPages = total === 0 ? 0 : Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages };
}

export function pageOf<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PageResult<T> {
  return { items, meta: toPageMeta(total, page, limit) };
}

export function isPageResult(value: unknown): value is PageResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'meta' in value &&
    typeof (value as { meta: unknown }).meta === 'object'
  );
}

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

/**
 * Sorting only against an explicit per-resource allowlist. Never accept a raw
 * column name or arbitrary `orderBy` from clients.
 */
export function parseSort(
  sort: string | undefined,
  allowlist: readonly string[],
): SortSpec | null {
  if (!sort || sort.length === 0) return null;
  const dir = sort.startsWith('-') ? ('desc' as const) : ('asc' as const);
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  if (!allowlist.includes(field)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Sort field '${field}' is not allowed. Allowed: ${allowlist.join(', ')}`,
      silent: true,
    });
  }
  return { field, dir };
}

export interface DateRange {
  from: Date;
  to: Date;
  invalid: boolean;
}

/** Parses inclusive dateFrom/dateTo. Invalid/mismatched ranges are rejected. */
export function parseDateRange(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  maxSpanDays = 366,
): { from: Date | null; to: Date | null } {
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;
  if (from && Number.isNaN(from.getTime())) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Invalid dateFrom',
      silent: true,
    });
  }
  if (to && Number.isNaN(to.getTime())) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Invalid dateTo',
      silent: true,
    });
  }
  if (from && to && from.getTime() > to.getTime()) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'dateFrom must be before dateTo',
      silent: true,
    });
  }
  if (from && to && (to.getTime() - from.getTime()) / 86_400_000 > maxSpanDays) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `Date range exceeds ${maxSpanDays} days`,
      silent: true,
    });
  }
  return { from, to };
}
