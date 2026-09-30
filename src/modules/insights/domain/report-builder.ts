/**
 * Pure report serialization: JSON/CSV/PDF summary-sheet building. The data
 * itself is gathered by reports.service.ts; these helpers stay deterministic
 * and unit-testable. Large exports are honest: there is no background worker in
 * this repository, so generation runs on request and the artifact carries an
 * expiry (documented in limitations.md).
 */

export interface ReportPayload {
  title: string;
  meta: Record<string, string>;
  rows: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  const first = rows[0];
  const headers = first ? Object.keys(first) : [];
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];
  return lines.join('\n');
}

export function rowsToJson(rows: Array<Record<string, unknown>>, summary: Record<string, unknown>): string {
  return JSON.stringify({ summary, rows }, null, 2);
}

/** The CSV header line, for the streaming writer. */
export function csvHeaderLine(headers: string[]): string {
  return headers.map(csvEscape).join(',');
}

/** One CSV line, for the streaming writer. Headerless. */
export function rowToCsvLine(row: Record<string, unknown>, headers: string[]): string {
  return headers.map((header) => csvEscape(row[header])).join(',');
}

/**
 * Emits the same bytes as {@link rowsToJson} one chunk at a time.
 *
 * JSON is written incrementally rather than `JSON.stringify`-ed whole, because
 * the whole string for a wide report is the thing we are trying to avoid
 * holding. The result is byte-identical to the buffered form, so a CSV/JSON
 * export does not change shape when it moves to the streaming path.
 */
export function* streamRowsToJson(
  rows: Array<Record<string, unknown>>,
  summary: Record<string, unknown>,
): Generator<string> {
  const NL = String.fromCharCode(10);
  const indent = (text: string, pad: string): string => text.split(NL).join(NL + pad);
  yield '{\n  "summary": ';
  yield indent(JSON.stringify(summary, null, 2), '  ');
  yield ',\n  "rows": [';
  for (const [index, row] of rows.entries()) {
    const comma = index < rows.length - 1 ? ',' : '';
    yield `${NL}    ${indent(JSON.stringify(row, null, 2), '    ')}${comma}`;
  }
  if (rows.length > 0) yield `${NL}  `;
  yield `]${NL}}`;
}

export function contentTypeOf(format: 'JSON' | 'CSV' | 'PDF'): string {
  switch (format) {
    case 'PDF':
      return 'application/pdf';
    case 'CSV':
      return 'text/csv';
    default:
      return 'application/json';
  }
}

export function fileExtensionOf(format: 'JSON' | 'CSV' | 'PDF'): string {
  return format.toLowerCase();
}
