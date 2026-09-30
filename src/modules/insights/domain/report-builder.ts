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
