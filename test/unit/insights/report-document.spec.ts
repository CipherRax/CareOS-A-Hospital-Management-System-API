import {
  DEFAULT_MAX_REPORT_ROWS,
  reportToPdfDocument,
} from '../../../src/modules/insights/domain/report-document';
import type { ReportPayload } from '../../../src/modules/insights/domain/report-builder';
import type {
  PdfBarChart,
  PdfTable,
  PdfKeyValues,
} from '../../../src/jobs/pdf/pdf-document';

const FROM = new Date('2026-09-01T00:00:00.000Z');
const TO = new Date('2026-09-30T23:59:59.000Z');

function payload(over: Partial<ReportPayload> = {}): ReportPayload {
  return {
    title: 'Patient register',
    meta: {
      from: FROM.toISOString(),
      to: TO.toISOString(),
      branchId: 'all',
      generatedAt: 'x',
    },
    rows: [],
    summary: {},
    ...over,
  };
}

function doc(over: Partial<ReportPayload> = {}, options = {}) {
  return reportToPdfDocument(payload(over), { from: FROM, to: TO, ...options });
}

function tableOf(spec: ReturnType<typeof doc>): PdfTable | undefined {
  return spec.sections.find((s): s is PdfTable => s.kind === 'table');
}

describe('reportToPdfDocument', () => {
  it('states the reporting window as a subtitle line', () => {
    const spec = doc();
    const paragraph = spec.sections.find((s) => s.kind === 'paragraph');
    expect(paragraph?.text).toContain('2026-09-01');
    expect(paragraph?.text).toContain('2026-09-30');
  });

  it('puts the window and branch in the header metadata', () => {
    const spec = doc();
    expect(spec.meta).toEqual(
      expect.arrayContaining([
        { label: 'From', value: FROM.toISOString() },
        { label: 'To', value: TO.toISOString() },
      ]),
    );
  });

  it('marks the document confidential and numbers pages', () => {
    const spec = doc({}, { confidentiality: 'Confidential' });
    expect(spec.footer).toBe('Confidential');
    expect(spec.pageNumbers).toBe(true);
  });

  it('says so plainly when nothing matched the window', () => {
    const spec = doc({ rows: [] });
    const texts = spec.sections.filter((s) => s.kind === 'paragraph').map((s) => s.text);
    expect(texts).toContain('No rows matched this window.');
    expect(tableOf(spec)).toBeUndefined();
  });
});

describe('summary handling', () => {
  it('renders scalar summary values as key/value pairs', () => {
    const spec = doc({ summary: { total: 120, noShowRate: 4.5 } });
    const kv = spec.sections.find((s): s is PdfKeyValues => s.kind === 'keyValues');
    expect(kv?.entries).toEqual([
      { label: 'Total', value: '120' },
      { label: 'No Show Rate', value: '4.5' },
    ]);
  });

  it('turns a count-per-category breakdown into a chart, not a list', () => {
    // `sexes: {MALE: 3, FEMALE: 2}` read off a key/value list has to be
    // eyeballed; the whole point of a breakdown is the shape.
    const spec = doc({ summary: { total: 5, sexes: { Male: 3, Female: 2 } } });
    const chart = spec.sections.find((s): s is PdfBarChart => s.kind === 'barChart');
    expect(chart?.title).toBe('Sexes');
    expect(chart?.points).toEqual([
      { label: 'Male', value: 3 },
      { label: 'Female', value: 2 },
    ]);
  });

  it('skips non-numeric members of a breakdown so the chart stays a chart', () => {
    const spec = doc({ summary: { statuses: { Completed: 4, notes: 'see log' } } });
    const chart = spec.sections.find((s): s is PdfBarChart => s.kind === 'barChart');
    expect(chart?.points).toEqual([{ label: 'Completed', value: 4 }]);
  });

  it('falls back to key/values when a breakdown has nothing countable', () => {
    const spec = doc({ summary: { methods: { Mpesa: 'cash', Cash: 'notes' } } });
    expect(spec.sections.some((s) => s.kind === 'barChart')).toBe(false);
    const kv = spec.sections.find((s): s is PdfKeyValues => s.kind === 'keyValues');
    expect(kv?.entries).toEqual([
      { label: 'Mpesa', value: 'cash' },
      { label: 'Cash', value: 'notes' },
    ]);
  });

  it('shows a null summary value as a dash rather than "null"', () => {
    const spec = doc({ summary: { revenue: null } });
    const kv = spec.sections.find((s): s is PdfKeyValues => s.kind === 'keyValues');
    expect(kv?.entries[0]?.value).toBe('—');
  });
});

describe('table derivation', () => {
  it('takes columns from the row keys in first-seen order', () => {
    const spec = doc({
      rows: [
        { patientNumber: 'P1', firstName: 'A', lastName: 'B' },
        { patientNumber: 'P2', sex: 'F', firstName: 'C' },
      ],
    });
    const table = tableOf(spec);
    expect(table?.columns.map((c) => c.header)).toEqual([
      'Patient Number',
      'First Name',
      'Last Name',
      'Sex',
    ]);
  });

  it('right-aligns a consistently numeric column and leaves a mixed one left', () => {
    const spec = doc({
      rows: [
        { total: 10, ref: 'A1' },
        { total: 20.5, ref: 20 },
      ],
    });
    const table = tableOf(spec);
    expect(table?.columns.find((c) => c.header === 'Total')?.align).toBe('right');
    // 'ref' is numeric in one row out of two, which is a code rather than a
    // measurement, so the 80% threshold keeps it left-aligned.
    expect(table?.columns.find((c) => c.header === 'Ref')?.align).toBeUndefined();
  });

  it('fills a missing cell with a dash instead of a blank', () => {
    const spec = doc({ rows: [{ a: '1', b: '2' }, { a: '3' }] });
    const table = tableOf(spec);
    expect(table?.rows[1]?.cells).toEqual(['3', '—']);
  });

  it('dims a cancelled row', () => {
    const spec = doc({
      rows: [
        { status: 'PAID' },
        { status: 'CANCELLED' },
        { status: 'VOIDED' },
        { status: 'COMPLETED' },
      ],
    });
    const table = tableOf(spec);
    expect(table?.rows.map((r) => r.muted)).toEqual([false, true, true, false]);
  });

  it('caps rows in the renderer rather than slicing, so the disclosure cannot be forgotten', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ n: i }));
    const spec = doc({ rows }, { maxRows: 4 });
    const table = tableOf(spec);
    // All ten are handed over; the renderer truncates and discloses "showing 4 of 10".
    expect(table?.rows).toHaveLength(10);
    expect(table?.maxRows).toBe(4);
  });

  it('derives columns only from rows that will actually be rendered', () => {
    // A key present solely in a row past the cap would otherwise add a column
    // that is blank in every visible row.
    const spec = doc({ rows: [{ a: 1 }, { a: 2, late: 'x' }] }, { maxRows: 1 });
    expect(tableOf(spec)?.columns.map((c) => c.header)).toEqual(['A']);
  });

  it('has a default row cap', () => {
    expect(DEFAULT_MAX_REPORT_ROWS).toBe(500);
  });
});
