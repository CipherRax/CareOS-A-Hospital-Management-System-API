/**
 * F10 reports fixtures (the report-export desk).
 *
 * Fabricated and EXAMPLE-prefixed throughout. The same history is duplicated in
 * `e2e/stub-api.mjs` so mock dev and the production build's e2e run cannot
 * silently drift.
 *
 * The seed walks every export status — PENDING, READY, FAILED and EXPIRED — so
 * each branch of the desk (poll, download, retry, expiry notice) is reachable.
 */

export type RegistryReportType =
  | 'PATIENT'
  | 'APPOINTMENT'
  | 'CLINICAL_OPERATIONS'
  | 'LABORATORY'
  | 'PHARMACY'
  | 'FINANCIAL'
  | 'INSURANCE'
  | 'OPERATIONS';

export type RegistryReportFormat = 'JSON' | 'CSV' | 'PDF';
export type RegistryReportStatus = 'PENDING' | 'READY' | 'FAILED' | 'EXPIRED';

export interface RegistryReportExport {
  readonly id: string;
  readonly reportType: RegistryReportType;
  readonly format: RegistryReportFormat;
  readonly status: RegistryReportStatus;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
  readonly summary: Record<string, unknown> | null;
  readonly error: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

/** A READY Patient register export: the artifact the desk can download. */
export const REPORT_EXPORTS: readonly RegistryReportExport[] = [
  {
    id: 'rep_example_0001',
    reportType: 'PATIENT',
    format: 'JSON',
    status: 'READY',
    contentType: 'application/json',
    sizeBytes: 2048,
    summary: { total: 12, sexes: { MALE: 7, FEMALE: 5 } },
    error: null,
    expiresAt: '2026-03-02T08:00:00.000Z',
    createdAt: '2026-03-01T08:00:00.000Z',
    completedAt: '2026-03-01T08:00:12.000Z',
  },
  {
    id: 'rep_example_0002',
    reportType: 'FINANCIAL',
    format: 'CSV',
    status: 'PENDING',
    contentType: 'text/csv',
    sizeBytes: null,
    summary: null,
    error: null,
    expiresAt: '2026-03-02T08:05:00.000Z',
    createdAt: '2026-03-01T08:05:00.000Z',
    completedAt: null,
  },
  {
    id: 'rep_example_0003',
    reportType: 'LABORATORY',
    format: 'PDF',
    status: 'FAILED',
    contentType: 'application/pdf',
    sizeBytes: null,
    summary: null,
    error: 'Render failed: a required glyph was missing from the PDF font.',
    expiresAt: '2026-03-02T07:30:00.000Z',
    createdAt: '2026-03-01T07:30:00.000Z',
    completedAt: '2026-03-01T07:30:04.000Z',
  },
  {
    id: 'rep_example_0004',
    reportType: 'APPOINTMENT',
    format: 'CSV',
    status: 'EXPIRED',
    contentType: 'text/csv',
    sizeBytes: 5120,
    summary: { total: 40, noShowRate: 12.5 },
    error: null,
    expiresAt: '2026-02-28T06:00:00.000Z',
    createdAt: '2026-02-27T06:00:00.000Z',
    completedAt: '2026-02-27T06:00:08.000Z',
  },
];
