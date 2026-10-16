import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableNumber,
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Reports (F10 — the report-export desk).
 *
 * The export endpoints return a bare object (or a page of them); the generated
 * OpenAPI types the bodies as `unknown`, so every body rides the raw-fetch path
 * and is validated structurally. A drifted body fails closed rather than
 * rendering as an empty history an operator would read as "nothing was exported".
 *
 * Generation is asynchronous: `POST /reports/export` answers 202 with a PENDING
 * row, and the artifact becomes downloadable only once the consumer has rendered
 * it (`READY`) and until it expires. The list is therefore polled while a row is
 * still PENDING, and the download is only offered for a READY, unexpired row.
 */

export type ReportsCallError = EnvelopeCallError;

export const REPORT_TYPES = [
  'PATIENT',
  'APPOINTMENT',
  'CLINICAL_OPERATIONS',
  'LABORATORY',
  'PHARMACY',
  'FINANCIAL',
  'INSURANCE',
  'OPERATIONS',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_FORMATS = ['JSON', 'CSV', 'PDF'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_STATUSES = ['PENDING', 'READY', 'FAILED', 'EXPIRED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportExportRow {
  readonly id: string;
  readonly reportType: ReportType;
  readonly format: ReportFormat;
  readonly status: ReportStatus;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
  readonly summary: Record<string, unknown> | null;
  readonly error: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface ReportPage {
  readonly rows: readonly ReportExportRow[];
  readonly total: number;
}

export interface ReportQuery {
  readonly reportType?: ReportType;
  readonly page?: number;
  readonly limit?: number;
}

/** The export request the service accepts (`ExportReportDto`). */
export interface RequestReportInput {
  readonly reportType: ReportType;
  readonly format: ReportFormat;
  readonly from?: string;
  readonly to?: string;
  readonly branchId?: string;
  readonly departmentId?: string;
}

/** Reads one serialized export; returns null when a required field has drifted. */
export function readReportExport(value: unknown): ReportExportRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.createdAt !== 'string') return null;
  if (typeof value.reportType !== 'string' || !REPORT_TYPES.includes(value.reportType as ReportType)) {
    return null;
  }
  if (typeof value.format !== 'string' || !REPORT_FORMATS.includes(value.format as ReportFormat)) {
    return null;
  }
  if (typeof value.status !== 'string' || !REPORT_STATUSES.includes(value.status as ReportStatus)) {
    return null;
  }
  return {
    id: value.id,
    reportType: value.reportType as ReportType,
    format: value.format as ReportFormat,
    status: value.status as ReportStatus,
    contentType: nullableString(value.contentType),
    sizeBytes: nullableNumber(value.sizeBytes),
    summary: isRecord(value.summary) ? value.summary : null,
    error: nullableString(value.error),
    expiresAt: nullableString(value.expiresAt),
    createdAt: value.createdAt,
    completedAt: nullableString(value.completedAt),
  };
}

/** Reads the export page from the unwrapped `data` plus the sibling `meta`. */
export function extractReportPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: ReportPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readReportExport);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly ReportExportRow[], total: pageTotal(meta, rows.length) },
  };
}

/** Reads a single-export body: the request and the detail read both answer an object. */
export function extractReportRecord(
  data: unknown,
): { ok: true; report: ReportExportRow } | { ok: false } {
  const report = readReportExport(data);
  return report ? { ok: true, report } : { ok: false };
}

/** Raw read against `GET /reports/exports?{filters}`. */
export async function fetchReportExports(
  query: ReportQuery = {},
  signal?: AbortSignal,
): Promise<ReportPage> {
  const suffix = queryString({
    reportType: query.reportType,
    page: query.page !== undefined ? String(query.page) : undefined,
    // The list DTO names the limit `pageSize`, not `limit`.
    pageSize: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/reports/exports${suffix}`;
  return readEnvelope<ReportPage>(
    url,
    (data, meta) => {
      const page = extractReportPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /reports/exports/{id}` (the service answers the record). */
export async function fetchReportExport(id: string, signal?: AbortSignal): Promise<ReportExportRow> {
  const url = `${publicEnv.apiBasePath}/reports/exports/${encodeURIComponent(id)}`;
  return readEnvelope<ReportExportRow>(
    url,
    (data) => {
      const parsed = extractReportRecord(data);
      return parsed.ok ? { ok: true, value: parsed.report } : { ok: false };
    },
    signal,
  );
}

/**
 * Builds the same-origin download URL for an export artifact. The bytes are
 * streamed through our own `/api/v1` proxy behind the session cookie, so a plain
 * link is enough — and it keeps the file off the JS heap, which a multi-megabyte
 * patient-data export should not be loaded onto.
 */
export function reportDownloadUrl(id: string): string {
  return `${publicEnv.apiBasePath}/reports/exports/${encodeURIComponent(id)}/download`;
}

/** True when a READY row's artifact is past its 24-hour expiry. */
export function isReportExpired(report: ReportExportRow, now: number): boolean {
  if (report.status === 'EXPIRED') return true;
  if (!report.expiresAt) return false;
  const expiry = Date.parse(report.expiresAt);
  return Number.isFinite(expiry) && expiry < now;
}
