/**
 * Turn a report payload into a PDF document specification.
 *
 * Reports used to be rendered as a flat list of `key: value` lines with rows
 * joined by `|`. That could not show a breakdown, so the two things a reader
 * actually wants from a register report — a table they can scan, and a picture
 * of the composition — were both flattened into text and had to be read out by
 * eye. The shape is now a real table, and a summary breakdown that is a
 * count-per-category becomes a chart.
 *
 * The conversion lives here rather than in the service so the layout rules can
 * be tested without rendering a document.
 */
import type {
  PdfColumn,
  PdfDocumentSpec,
  PdfSection,
} from '../../../jobs/pdf/pdf-document';
import type { ReportPayload } from './report-builder';

/** Rows beyond this are not embedded. The document discloses the truncation. */
export const DEFAULT_MAX_REPORT_ROWS = 500;

/** How a value is rendered inside a table cell. */
function cell(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Values that look numeric get right-aligned and a compact format. */
function looksNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  return value.trim() !== '' && Number.isFinite(Number(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function isScalar(value: unknown): boolean {
  return value == null || typeof value !== 'object';
}

function titleCase(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface ReportDocumentOptions {
  /** Reporting window, shown under the title. */
  from: Date;
  to: Date;
  branchLabel?: string;
  /** Show "Page N of M" and a confidentiality footer. */
  confidentiality?: string;
  maxRows?: number;
  createdAt?: Date;
}

export function reportToPdfDocument(
  payload: ReportPayload,
  options: ReportDocumentOptions,
): PdfDocumentSpec {
  const maxRows = Math.max(0, options.maxRows ?? DEFAULT_MAX_REPORT_ROWS);
  const sections: PdfSection[] = [];

  sections.push({
    kind: 'paragraph',
    text: `Reporting window ${options.from.toISOString()} to ${options.to.toISOString()}`,
    muted: true,
  });

  // Summary: scalars are facts, records are breakdowns. Splitting them means a
  // count-per-category breakdown gets a chart instead of being read off a list.
  const scalars: Array<{ label: string; value: string }> = [];
  const breakdowns: Array<{ label: string; record: Record<string, unknown> }> = [];
  for (const [key, value] of Object.entries(payload.summary)) {
    if (isScalar(value)) {
      scalars.push({ label: titleCase(key), value: cell(value) });
    } else if (isPlainRecord(value)) {
      breakdowns.push({ label: titleCase(key), record: value });
    } else {
      scalars.push({ label: titleCase(key), value: cell(value) });
    }
  }
  if (scalars.length > 0) {
    sections.push({
      kind: 'keyValues',
      entries: scalars,
      columns: scalars.length > 4 ? 3 : 2,
    });
  }
  for (const breakdown of breakdowns) {
    const points = Object.entries(breakdown.record)
      .filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      )
      .map(([label, value]) => ({ label: titleCase(label), value }));
    if (points.length === 0) {
      // Nothing countable here (e.g. a map of strings) — show it as values
      // rather than dropping it on the floor.
      sections.push({
        kind: 'keyValues',
        entries: Object.entries(breakdown.record).map(([label, value]) => ({
          label: titleCase(label),
          value: cell(value),
        })),
      });
      continue;
    }
    sections.push({ kind: 'barChart', title: breakdown.label, points });
  }

  const columns = deriveColumns(payload.rows, maxRows);
  if (columns.length > 0) {
    sections.push({
      kind: 'table',
      caption: `Rows (${payload.rows.length})`,
      columns,
      // The cap is handed to the renderer rather than applied here, so the
      // "showing N of M" disclosure cannot be left out by a future caller.
      maxRows,
      rows: payload.rows.map((row) => ({
        cells: columns.map((column) => cell(row[column.key])),
        muted: rowMuted(row),
      })),
    });
  } else if (payload.rows.length === 0) {
    sections.push({
      kind: 'paragraph',
      text: 'No rows matched this window.',
      muted: true,
    });
  }

  return {
    title: payload.title,
    subtitle: undefined,
    meta: [
      { label: 'From', value: options.from.toISOString() },
      { label: 'To', value: options.to.toISOString() },
      { label: 'Branch', value: options.branchLabel ?? payload.meta.branchId ?? 'all' },
      { label: 'Generated', value: (options.createdAt ?? new Date()).toISOString() },
    ],
    sections,
    footer: options.confidentiality,
    pageNumbers: true,
    subject: `${payload.title} report`,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  };
}

/** A row that reads as cancelled/void is dimmed rather than dropped. */
function rowMuted(row: Record<string, unknown>): boolean {
  const status = row.status;
  return (
    typeof status === 'string' && /^(CANCELLED|VOIDED|REVERSED|EXPIRED)$/i.test(status)
  );
}

interface DerivedColumn extends PdfColumn {
  key: string;
}

function deriveColumns(
  rows: Array<Record<string, unknown>>,
  maxRows: number,
): DerivedColumn[] {
  // Only the rows that will actually be rendered determine the column set; a
  // row beyond the cap must not add a column that is then always blank.
  const sample = rows.slice(0, maxRows);
  const keys: string[] = [];
  const numericVotes = new Map<string, number>();
  for (const row of sample) {
    for (const [key, value] of Object.entries(row)) {
      if (!keys.includes(key)) {
        keys.push(key);
        numericVotes.set(key, 0);
      }
      if (looksNumeric(value)) {
        numericVotes.set(key, (numericVotes.get(key) ?? 0) + 1);
      }
    }
  }
  return keys.map((key) => {
    // Mostly-numeric column reads as a number, so align it right. A column that
    // is only sometimes numeric (an id that looks like one) stays left.
    const votes = numericVotes.get(key) ?? 0;
    const numeric = sample.length > 0 && votes / sample.length >= 0.8;
    return {
      key,
      header: titleCase(key),
      compact: true,
      ...(numeric ? { align: 'right' as const } : {}),
    };
  });
}
