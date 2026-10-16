import { describe, expect, it } from 'vitest';

import {
  extractReportPage,
  extractReportRecord,
  isReportExpired,
  readReportExport,
  type ReportExportRow,
} from '@/lib/data/reports';

/**
 * F10 reports data layer.
 *
 * The generated OpenAPI types the export bodies as `unknown`, so every body is
 * validated structurally. Each reader fails closed on drift rather than
 * rendering an empty history or a phantom export.
 */

const report: ReportExportRow = {
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
};

describe('readReportExport', () => {
  it('reads a full export record', () => {
    expect(readReportExport(report)).toMatchObject({
      id: 'rep_example_0001',
      reportType: 'PATIENT',
      format: 'JSON',
      status: 'READY',
      sizeBytes: 2048,
      summary: { total: 12 },
      completedAt: '2026-03-01T08:00:12.000Z',
    });
  });

  it('tolerates a null summary and missing optional fields', () => {
    const parsed = readReportExport({
      id: 'rep_2',
      reportType: 'FINANCIAL',
      format: 'CSV',
      status: 'PENDING',
      createdAt: '2026-03-01T08:00:00.000Z',
    });
    expect(parsed?.summary).toBeNull();
    expect(parsed?.contentType).toBeNull();
    expect(parsed?.sizeBytes).toBeNull();
    expect(parsed?.error).toBeNull();
  });

  it('fails closed on an unknown type, format or status', () => {
    expect(readReportExport({ ...report, reportType: 'UNKNOWN' })).toBeNull();
    expect(readReportExport({ ...report, format: 'XLSX' })).toBeNull();
    expect(readReportExport({ ...report, status: 'DONE' })).toBeNull();
    expect(readReportExport(null)).toBeNull();
  });
});

describe('extractReportPage', () => {
  it('reads the page and its total from meta', () => {
    const parsed = extractReportPage([report], { total: 5 });
    expect(parsed.ok && parsed.page.total).toBe(5);
    expect(parsed.ok && parsed.page.rows.length).toBe(1);
  });

  it('fails closed when a row has drifted', () => {
    expect(extractReportPage([{ ...report, status: 'BOGUS' }], {}).ok).toBe(false);
    expect(extractReportPage(null, {}).ok).toBe(false);
  });
});

describe('extractReportRecord', () => {
  it('reads a bare record body', () => {
    expect(extractReportRecord(report).ok).toBe(true);
  });

  it('fails closed on a drifted body', () => {
    expect(extractReportRecord({ id: 'rep_2' }).ok).toBe(false);
  });
});

describe('isReportExpired', () => {
  const now = Date.parse('2026-03-01T09:00:00.000Z');

  it('treats an EXPIRED status as expired regardless of the clock', () => {
    expect(isReportExpired({ ...report, status: 'EXPIRED' }, now)).toBe(true);
  });

  it('compares the expiry against the clock', () => {
    expect(isReportExpired({ ...report, expiresAt: '2026-03-01T08:30:00.000Z' }, now)).toBe(true);
    expect(isReportExpired(report, now)).toBe(false);
  });

  it('treats a missing expiry as not expired', () => {
    expect(isReportExpired({ ...report, expiresAt: null }, now)).toBe(false);
  });
});
