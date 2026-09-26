import {
  contentTypeOf,
  fileExtensionOf,
  rowsToCsv,
  rowsToJson,
  rowsToPdfLines,
} from '../../../src/modules/insights/domain/report-builder';
import type { ReportPayload } from '../../../src/modules/insights/domain/report-builder';

describe('rowsToCsv', () => {
  it('emits headers from the first row', () => {
    const csv = rowsToCsv([{ id: '1', name: 'A', amount: 10 }]);
    expect(csv.split('\n')[0]).toBe('id,name,amount');
  });

  it('escapes commas, quotes and newlines', () => {
    const csv = rowsToCsv([{ id: '1', name: 'Smith, "John"\nJr' }]);
    expect(csv).toContain('"Smith, ""John""\nJr"');
  });

  it('returns an empty string for no rows', () => {
    expect(rowsToCsv([])).toBe('');
  });
});

describe('rowsToJson', () => {
  it('wraps rows with the summary', () => {
    const out = JSON.parse(rowsToJson([{ id: 1 }], { total: 1 }));
    expect(out.summary.total).toBe(1);
    expect(out.rows).toEqual([{ id: 1 }]);
  });
});

describe('contentTypeOf / fileExtensionOf', () => {
  it('maps formats to content types', () => {
    expect(contentTypeOf('PDF')).toBe('application/pdf');
    expect(contentTypeOf('CSV')).toBe('text/csv');
    expect(contentTypeOf('JSON')).toBe('application/json');
  });

  it('derives file extensions', () => {
    expect(fileExtensionOf('PDF')).toBe('pdf');
    expect(fileExtensionOf('JSON')).toBe('json');
  });
});

describe('rowsToPdfLines', () => {
  const payload: ReportPayload = {
    title: 'Operations report',
    meta: { from: '2026-09-01', to: '2026-09-30' },
    summary: { visits: 120 },
    rows: Array.from({ length: 60 }, (_, i) => ({ index: i + 1, value: i * 2 })),
  };

  it('renders a header, summary and truncated rows', () => {
    const lines = rowsToPdfLines(payload);
    expect(lines[0]).toBe('Report: Operations report');
    expect(lines).toContain('  visits: 120');
    expect(lines.filter((l) => /^\s+\d+\. /.test(l))).toHaveLength(50);
    expect(lines).toContain('  ... and 10 more rows');
  });
});