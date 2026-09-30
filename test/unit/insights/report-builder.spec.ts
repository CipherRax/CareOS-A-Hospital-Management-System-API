import {
  contentTypeOf,
  fileExtensionOf,
  rowToCsvLine,
  rowsToCsv,
  rowsToJson,
  streamRowsToJson,
} from '../../../src/modules/insights/domain/report-builder';

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

describe('streamRowsToJson', () => {
  // The streaming writer replaced a `JSON.stringify` of the whole document. If
  // the bytes differ at all, an export changes shape purely as an artefact of
  // how it was produced, so these pin byte-identity rather than mere validity.
  const cases: Array<[string, Array<Record<string, unknown>>, Record<string, unknown>]> = [
    ['two rows', [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], { total: 2 }],
    ['one row', [{ id: 1 }], { total: 1 }],
    ['no rows', [], { total: 0 }],
    [
      'nested values and quotes',
      [{ id: 1, meta: { tags: ['x', 'y'] }, note: 'he said "hi"\nnewline' }],
      { total: 1, window: { from: 'a', to: 'b' } },
    ],
  ];

  for (const [label, rows, summary] of cases) {
    it(`matches the buffered form byte for byte: ${label}`, () => {
      expect([...streamRowsToJson(rows, summary)].join('')).toBe(rowsToJson(rows, summary));
    });
  }

  it('is parseable JSON, not merely identical text', () => {
    const out = JSON.parse([...streamRowsToJson([{ id: 1 }], { total: 1 })].join(''));
    expect(out.rows).toEqual([{ id: 1 }]);
  });

  it('yields incrementally instead of one whole-document chunk', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    // A generator that built the document first would emit a single chunk.
    expect([...streamRowsToJson(many, { total: 50 })].length).toBeGreaterThan(50);
  });
});

describe('rowToCsvLine', () => {
  it('produces the same lines as the buffered CSV writer', () => {
    const rows: Array<Record<string, unknown>> = [
      { id: '1', name: 'Smith, "John"' },
      { id: '2', name: 'plain' },
    ];
    const headers = Object.keys(rows[0] ?? {});
    // The buffered writer emits the header first; the line helper does not.
    const streamed = [headers.join(','), ...rows.map((r) => rowToCsvLine(r, headers))].join('\n');
    expect(streamed).toBe(rowsToCsv(rows));
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
