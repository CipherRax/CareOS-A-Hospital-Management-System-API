import {
  contentTypeOf,
  fileExtensionOf,
  rowsToCsv,
  rowsToJson,
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
