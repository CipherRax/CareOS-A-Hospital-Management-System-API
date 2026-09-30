/**
 * Declarative description of a PDF artifact.
 *
 * This is a data model, not a pdfkit type. Callers (report exports, document
 * jobs) describe *what* the document contains and the renderer decides how to
 * lay it out, so adding a chart or an image to a report does not mean learning
 * a drawing API. Keeping the model free of pdfkit is also what lets the layout
 * and the numeric logic be unit-tested without rendering anything.
 *
 * Every field is plain data so a document spec can be built, serialised into an
 * audit trail, and re-rendered later to the same bytes.
 */

export interface PdfMetaEntry {
  label: string;
  value: string;
}

export interface PdfColumn {
  /** Header text. Also the default width key. */
  header: string;
  /**
   * Relative width. Columns are laid out proportionally, so `[3, 1]` gives the
   * first column three times the space of the second. Weights are normalised,
   * so absolute values do not matter — only their ratios.
   */
  weight?: number;
  /** Right-align the column (numbers, money, counts). */
  align?: 'left' | 'right';
  /**
   * Abbreviate the header to fit, instead of wrapping it over several lines.
   * Report tables often have more columns than fit at readable sizes.
   */
  compact?: boolean;
}

export interface PdfTableRow {
  /** Cell text, positionally matched to `columns`. */
  cells: string[];
  /** Draw the row in a muted tone (e.g. a cancelled invoice). */
  muted?: boolean;
  /** Repeat the previous row's cell values (grouped reports). */
  continuation?: boolean;
}

export interface PdfTable {
  kind: 'table';
  columns: PdfColumn[];
  rows: PdfTableRow[];
  caption?: string;
  /**
   * Cap on rows embedded in the document. Beyond this the table is truncated
   * and the count is disclosed. The cap lives here, next to the disclosure,
   * rather than in each caller: a caller that slices without disclosing has
   * produced a report that looks complete and is not.
   */
  maxRows?: number;
  /**
   * Show "showing N of M" under the table when rows were omitted. Defaults to
   * true. Turning it off is only defensible when the caller has already stated
   * the count elsewhere.
   */
  discloseOmitted?: boolean;
}

export interface PdfParagraph {
  kind: 'paragraph';
  text: string;
  /** Render in a smaller muted face — asides, provenance notes. */
  muted?: boolean;
  /** Centre the text instead of filling the column. */
  align?: 'left' | 'center' | 'right';
}

export interface PdfKeyValues {
  kind: 'keyValues';
  entries: Array<{ label: string; value: string }>;
  /** Lay entries out in this many columns. */
  columns?: number;
}

export interface PdfChartPoint {
  label: string;
  value: number;
}

export interface PdfBarChart {
  kind: 'barChart';
  title: string;
  points: PdfChartPoint[];
  /** Print a total/axis unit, e.g. "KES" or "count". */
  unit?: string;
  /** Cap on rendered bars; the remainder is reported, never silently dropped. */
  maxBars?: number;
}

export interface PdfLineChart {
  kind: 'lineChart';
  title: string;
  points: PdfChartPoint[];
  unit?: string;
  maxPoints?: number;
}

export interface PdfImage {
  kind: 'image';
  data: Buffer;
  /** pngkit accepts png and jpeg; anything else is a programming error. */
  format: 'png' | 'jpeg';
  caption?: string;
  /**
   * Target width in points. Height follows the image's aspect ratio unless
   * `height` is given. Defaults to the full content width.
   */
  width?: number;
  height?: number;
}

export interface PdfSpacer {
  kind: 'spacer';
  /** Height in points. */
  size?: number;
}

export interface PdfPageBreak {
  kind: 'pageBreak';
}

export type PdfSection =
  | PdfTable
  | PdfParagraph
  | PdfKeyValues
  | PdfBarChart
  | PdfLineChart
  | PdfImage
  | PdfSpacer
  | PdfPageBreak;

export interface PdfDocumentSpec {
  title: string;
  subtitle?: string;
  meta?: PdfMetaEntry[];
  /** A4 is the regional default; LETTER is offered for US deployments. */
  pageSize?: 'A4' | 'LETTER';
  sections: PdfSection[];
  /**
   * Repeated at the bottom of every page. `pageNumbers` appends "Page N of M",
   * which requires a second pass over the buffered pages.
   */
  footer?: string;
  pageNumbers?: boolean;
  /**
   * PDF metadata. `subject` should carry the tenant/reporting window so an
   * artifact found on a disk months later still says what it is.
   */
  subject?: string;
  author?: string;
  keywords?: string;
  /**
   * Creation timestamp. Injectable so a test can assert byte-stability; the
   * renderer otherwise uses the clock at render time.
   */
  createdAt?: Date;
  /**
   * Require every glyph in the document to be present in the embedded font.
   * Defaults to true: a missing glyph is a silent corruption (a patient name
   * rendered as a blank box), so it is better to fail the render than to
   * emit a document that quietly drops characters.
   */
  strictGlyphs?: boolean;
}
