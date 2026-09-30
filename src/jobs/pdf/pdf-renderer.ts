/**
 * PDF rendering.
 *
 * Replaces the hand-rolled writer that emitted `%PDF-1.4` with Helvetica and
 * `Tj` operators. That could not set a title in any script outside WinAnsi — a
 * patient's name in Greek, or a lab unit like `µmol/L`, came out as mojibake —
 * and had no way to draw a table, a chart, or an image. Reports and document
 * jobs now go through PDFKit with a real embedded Unicode font.
 *
 * Layout rules that matter more than they look:
 *
 *  - Missing data is drawn as words ("no data"), never as an empty plot. An
 *    empty axis reads as "all values are zero", which is a different claim.
 *  - Anything dropped from a chart (non-finite values, points past a cap) is
 *    counted and printed under it. A clinical report that quietly omits a data
 *    point is not a report.
 *  - Text is checked against the font's glyph coverage before it is drawn,
 *    because PDFKit drops uncovered characters silently. See `pdf-fonts.ts`.
 */
import PDFDocument from 'pdfkit';
import { Writable } from 'node:stream';
import type { GlyphCoverage } from './pdf-fonts';
import { loadFonts, type PdfFontStyle, type ResolvedFont } from './pdf-fonts';
import { MissingGlyphError, PdfRenderError } from './pdf-errors';
import { fitWithin, inspectImage } from './pdf-images';
import {
  barChartGeometry,
  lineChartGeometry,
  prepareSeries,
  type ChartGeometry,
} from './pdf-charts';
import type {
  PdfBarChart,
  PdfColumn,
  PdfDocumentSpec,
  PdfImage,
  PdfKeyValues,
  PdfLineChart,
  PdfSection,
  PdfTable,
  PdfTableRow,
} from './pdf-document';

const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  LETTER: { width: 612, height: 792 },
} as const;

const MARGIN = 48;
const FOOTER_RESERVE = 30;
const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;
const MIN_ROW_HEIGHT = 16;
const MAX_ROW_HEIGHT = 96;
const BAR_CHART_HEIGHT = 150;
const LINE_CHART_HEIGHT = 120;
const PLOT_PADDING = { top: 10, right: 10, bottom: 26, left: 48 };

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const ACCENT = '#1d4ed8';
const TABLE_HEAD_BG = '#f3f4f6';
const TABLE_BAND_BG = '#f9fafb';

/**
 * Render a document specification to PDF bytes.
 *
 * Kept for callers that want the whole document in memory. Report export uses
 * {@link renderPdfTo} instead so a large artifact is never held whole.
 */
export function renderPdf(spec: PdfDocumentSpec): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return renderPdfTo(spec, sinkOf(chunks)).then(() => Buffer.concat(chunks));
}

/** Collects into an array; used only by the buffering entry point above. */
function sinkOf(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
}

/**
 * Render a document specification straight into a sink.
 *
 * PDFKit writes incrementally, so piping into storage or a file keeps memory at
 * the sink's high-water mark instead of the artifact's full size. The sink is
 * not closed — the caller owns it, because a streaming upload needs the bytes
 * flushed before it finalises the object.
 */
export function renderPdfTo(spec: PdfDocumentSpec, sink: Writable): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let fonts: Map<PdfFontStyle, ResolvedFont>;
    try {
      fonts = loadFonts();
    } catch (error) {
      reject(error);
      return;
    }

    const pageSize = PAGE_SIZES[spec.pageSize ?? 'A4'];
    const needsSecondPass = Boolean(spec.footer) || spec.pageNumbers === true;
    const createdAt = spec.createdAt ?? new Date();

    const doc = new PDFDocument({
      size: [pageSize.width, pageSize.height],
      margin: MARGIN,
      bufferPages: needsSecondPass,
      autoFirstPage: false,
      info: {
        Title: spec.title,
        ...(spec.author ? { Author: spec.author } : {}),
        ...(spec.subject ? { Subject: spec.subject } : {}),
        ...(spec.keywords ? { Keywords: spec.keywords } : {}),
        CreationDate: createdAt,
        ModDate: createdAt,
        // Stamped rather than left to the library so an artifact identifies the
        // system that produced it and output does not drift with upgrades.
        Producer: 'careOS',
        Creator: 'careOS',
      },
    });

    for (const font of fonts.values()) doc.registerFont(font.name, font.path);

    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    doc.on('error', fail);
    // A sink failure (a dropped upload, a full disk) has to fail the render too,
    // or the promise would resolve while the bytes went nowhere.
    sink.on('error', fail);
    doc.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    doc.pipe(sink, { end: false });

    try {
      new PdfLayout(doc, fonts, spec, pageSize).build();
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
      // Release the stream so PDFKit's internal buffers are freed even though
      // the render failed part-way.
      doc.end();
      return;
    }
    doc.end();
  });
}

/**
 * Text options this renderer understands on top of PDFKit's own.
 *
 * `x`, `y`, `fontSize`, and `color` are lifted out of PDFKit's `TextOptions`
 * and applied here instead, because PDFKit silently ignores all four when they
 * are passed inside the options object. `_initOptions` treats an object first
 * argument as the options bag and only ever moves the cursor from the
 * *positional* x and y, and text rendering reads fill colour from
 * `document._fillColor` rather than from the options. Passing
 * `{ x, y, fontSize, color }` therefore produced a document with every string
 * stacked at the flow position at the default size in the default colour, and
 * no error at all — which is exactly the kind of failure this indirection
 * exists to prevent.
 */
interface TextOpts extends PDFKit.Mixins.TextOptions {
  style?: PdfFontStyle;
  fontSize: number;
  color?: string;
  x?: number;
  y?: number;
}

interface MeasureOpts extends PDFKit.Mixins.TextOptions {
  fontSize: number;
}

class PdfLayout {
  private readonly contentWidth: number;
  private readonly pageBottom: number;
  private readonly strict: boolean;
  /** Where we are in the document, for error messages. */
  private context: string;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly fonts: Map<PdfFontStyle, ResolvedFont>,
    private readonly spec: PdfDocumentSpec,
    private readonly pageSize: { width: number; height: number },
  ) {
    this.contentWidth = pageSize.width - MARGIN * 2;
    this.pageBottom = pageSize.height - MARGIN - FOOTER_RESERVE;
    this.strict = spec.strictGlyphs !== false;
    this.context = 'the document';
  }

  build(): void {
    this.doc.addPage();
    this.drawHeader();
    for (const section of this.spec.sections) this.drawSection(section);
    this.drawFooter();
  }

  private fontFor(style: PdfFontStyle): ResolvedFont {
    const font = this.fonts.get(style);
    if (!font) throw new PdfRenderError(`PDF font "${style}" was not loaded.`);
    return font;
  }

  private coverageFor(style: PdfFontStyle): GlyphCoverage {
    return this.fontFor(style).coverage;
  }

  /**
   * Draw text, refusing characters the font cannot render.
   *
   * With `x`/`y` the text is placed absolutely; without them it flows from the
   * left margin. Flow text is anchored to the margin rather than to the
   * document's current x, because PDFKit moves `this.x`/`this.y` to the
   * position of an absolutely-placed call and leaves them there. A chart's
   * category label is centred on its point and can sit outside the content
   * box, so a following flow call would otherwise start at a negative x and
   * run off the left edge of the page.
   */
  private text(value: string, options: TextOpts): void {
    const { style = 'regular', fontSize, color, x, y, ...rest } = options;
    if (this.strict) {
      const missing = this.coverageFor(style).missingIn(value);
      if (missing.length > 0) throw new MissingGlyphError(missing, this.context);
    }
    this.doc.font(this.fontFor(style).name).fontSize(fontSize);
    if (color) this.doc.fillColor(color);
    if (x === undefined && y === undefined) {
      this.doc.text(value, MARGIN, this.doc.y, { width: this.contentWidth, ...rest });
      return;
    }
    this.doc.text(value, x ?? this.doc.x, y ?? this.doc.y, {
      width: this.contentWidth,
      ...rest,
    });
  }

  private heightOf(value: string, options: MeasureOpts, style: PdfFontStyle): number {
    return this.doc
      .font(this.fontFor(style).name)
      .fontSize(options.fontSize)
      .heightOfString(value, options);
  }

  private ensureSpace(height: number): void {
    if (this.doc.y + height > this.pageBottom) this.doc.addPage();
  }

  private drawHeader(): void {
    this.context = 'the document title';
    this.text(this.spec.title, {
      x: MARGIN,
      y: this.doc.y,
      width: this.contentWidth,
      fontSize: 18,
      style: 'bold',
      color: INK,
    });
    if (this.spec.subtitle) {
      this.context = 'the document subtitle';
      this.text(this.spec.subtitle, {
        width: this.contentWidth,
        fontSize: 10.5,
        color: MUTED,
      });
    }
    if (this.spec.meta?.length) this.drawMeta(this.spec.meta);
    this.context = 'the document';
    this.drawRule();
    this.doc.y += 6;
  }

  /** Meta as two columns so a long reporting window does not push the body down. */
  private drawMeta(meta: NonNullable<PdfDocumentSpec['meta']>): void {
    const perColumn = Math.ceil(meta.length / 2);
    const columnWidth = this.contentWidth / 2;
    const labelWidth = columnWidth * 0.42;
    const rows = Math.max(perColumn, meta.length - perColumn);
    for (let i = 0; i < rows; i += 1) {
      this.ensureSpace(14);
      const y = this.doc.y;
      for (const [column, offset] of [
        [0, 0],
        [1, perColumn],
      ] as const) {
        const entry = meta[offset + i];
        if (!entry) continue;
        this.context = `the "${entry.label}" header field`;
        const x = MARGIN + column * columnWidth;
        this.text(entry.label, { x, y, width: labelWidth, fontSize: 8.5, color: MUTED });
        this.text(entry.value, {
          x: x + labelWidth,
          y,
          width: columnWidth - labelWidth - 8,
          fontSize: 8.5,
          color: INK,
        });
      }
      this.doc.y = y + 12;
    }
  }

  private drawRule(): void {
    this.doc
      .moveTo(MARGIN, this.doc.y)
      .lineTo(MARGIN + this.contentWidth, this.doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
  }

  private drawSection(section: PdfSection): void {
    switch (section.kind) {
      case 'pageBreak':
        this.doc.addPage();
        return;
      case 'spacer':
        this.doc.y += section.size ?? 8;
        return;
      case 'paragraph':
        this.drawParagraph(section.text, section.muted === true, section.align ?? 'left');
        return;
      case 'keyValues':
        this.drawKeyValues(section);
        return;
      case 'table':
        this.drawTable(section);
        return;
      case 'barChart':
        this.drawBarChart(section);
        return;
      case 'lineChart':
        this.drawLineChart(section);
        return;
      case 'image':
        this.drawImage(section);
        return;
      default: {
        const exhaustive: never = section;
        throw new PdfRenderError(
          `Unsupported PDF section: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  private drawParagraph(
    text: string,
    muted: boolean,
    align: 'left' | 'center' | 'right',
  ): void {
    if (text.trim() === '') {
      this.doc.y += 6;
      return;
    }
    this.ensureSpace(24);
    this.context = 'a paragraph';
    this.text(text, {
      width: this.contentWidth,
      fontSize: 9.5,
      lineGap: muted ? 1.5 : 2.5,
      align,
      color: muted ? MUTED : INK,
    });
  }

  private drawKeyValues(section: PdfKeyValues): void {
    if (section.entries.length === 0) return;
    const columns = Math.max(1, Math.min(4, section.columns ?? 2));
    const perColumn = Math.ceil(section.entries.length / columns);
    const columnWidth = this.contentWidth / columns;
    const labelWidth = columnWidth * 0.45;
    for (let i = 0; i < perColumn; i += 1) {
      this.ensureSpace(14);
      const y = this.doc.y;
      for (let c = 0; c < columns; c += 1) {
        const entry = section.entries[c * perColumn + i];
        if (!entry) continue;
        this.context = `the "${entry.label}" value`;
        const x = MARGIN + c * columnWidth;
        this.text(entry.label, { x, y, width: labelWidth, fontSize: 9, color: MUTED });
        this.text(entry.value, {
          x: x + labelWidth,
          y,
          width: columnWidth - labelWidth - 6,
          fontSize: 9,
          color: INK,
        });
      }
      this.doc.y = y + 13;
    }
  }

  private drawTable(section: PdfTable): void {
    const columns = section.columns;
    if (columns.length === 0) return;
    if (section.caption) this.drawHeading(section.caption);

    const maxRows = Math.max(0, Math.floor(section.maxRows ?? Number.POSITIVE_INFINITY));
    const total = section.rows.length;
    const rows = section.rows.slice(0, maxRows);

    const weights = columns.map((column) => Math.max(0.1, column.weight ?? 1));
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((weight) => (weight / weightTotal) * this.contentWidth);

    let index = 0;
    while (index < rows.length) {
      // The header repeats on every page a table continues onto, so a table
      // split across pages stays readable.
      const headHeight = this.measureHeaderRow(columns, widths);
      if (this.doc.y + headHeight > this.pageBottom) this.doc.addPage();
      this.drawHeaderRow(columns, widths, headHeight);
      this.doc.y += headHeight;

      let drewOnThisPage = false;
      while (index < rows.length) {
        const row = rows[index] as PdfTableRow;
        const cells = normaliseCells(row.cells, columns.length);
        const height = this.measureBodyRow(cells, widths);
        if (this.doc.y + height > this.pageBottom) {
          // Rows are height-capped, so one always fits on a fresh page; the
          // guard only exists to stop an infinite loop.
          if (drewOnThisPage) break;
          this.doc.addPage();
        }
        this.drawBodyRow(cells, widths, height, row, columns, index);
        this.doc.y += height;
        index += 1;
        drewOnThisPage = true;
      }
      if (index < rows.length) this.doc.addPage();
    }

    if (total > index && section.discloseOmitted !== false) {
      this.doc.y += 3;
      this.context = 'the table row-count note';
      this.text(`Showing ${index} of ${total} rows.`, {
        width: this.contentWidth,
        fontSize: 8,
        style: 'italic',
        color: MUTED,
      });
    }
    this.doc.y += 6;
  }

  private measureHeaderRow(columns: PdfColumn[], widths: number[]): number {
    let max = MIN_ROW_HEIGHT;
    columns.forEach((column, i) => {
      const width = (widths[i] as number) - CELL_PAD_X * 2;
      // A long header either wraps or is abbreviated; wrapping is capped so one
      // verbose header cannot eat a page.
      const options: MeasureOpts = column.compact
        ? { fontSize: 8, ellipsis: true, width, lineBreak: false }
        : { fontSize: 8, width };
      max = Math.max(
        max,
        Math.min(this.heightOf(column.header, options, 'bold'), MAX_ROW_HEIGHT) +
          CELL_PAD_Y * 2,
      );
    });
    return max;
  }

  private measureBodyRow(cells: string[], widths: number[]): number {
    let max = MIN_ROW_HEIGHT;
    cells.forEach((cell, i) => {
      const width = (widths[i] as number) - CELL_PAD_X * 2;
      const height = this.heightOf(cell, { fontSize: 8.5, width }, 'regular');
      max = Math.max(max, Math.min(height, MAX_ROW_HEIGHT) + CELL_PAD_Y * 2);
    });
    return max;
  }

  private drawHeaderRow(columns: PdfColumn[], widths: number[], height: number): void {
    this.doc.rect(MARGIN, this.doc.y, this.contentWidth, height).fill(TABLE_HEAD_BG);
    let x = MARGIN;
    columns.forEach((column, i) => {
      const width = widths[i] as number;
      this.context = `the "${column.header}" column header`;
      this.text(column.header, {
        x: x + CELL_PAD_X,
        y: this.doc.y + CELL_PAD_Y,
        width: width - CELL_PAD_X * 2,
        fontSize: 8,
        style: 'bold',
        color: INK,
        align: column.align ?? 'left',
        lineBreak: column.compact !== true,
        ellipsis: true,
      });
      x += width;
    });
    this.drawRule();
  }

  private drawBodyRow(
    cells: string[],
    widths: number[],
    height: number,
    row: PdfTableRow,
    columns: PdfColumn[],
    rowIndex: number,
  ): void {
    // Zebra striping, skipped on continuation rows so a visually grouped block
    // reads as one group.
    if (!row.continuation && rowIndex % 2 === 1) {
      this.doc.rect(MARGIN, this.doc.y, this.contentWidth, height).fill(TABLE_BAND_BG);
    }
    let x = MARGIN;
    cells.forEach((cell, i) => {
      const width = widths[i] as number;
      const column = columns[i];
      this.context = `row ${rowIndex + 1}, column "${column?.header ?? i + 1}"`;
      this.text(cell, {
        x: x + CELL_PAD_X,
        y: this.doc.y + CELL_PAD_Y,
        width: width - CELL_PAD_X * 2,
        height: height - CELL_PAD_Y * 2,
        fontSize: 8.5,
        style: row.continuation ? 'italic' : 'regular',
        color: row.muted ? MUTED : INK,
        align: column?.align ?? 'left',
        ellipsis: true,
      });
      x += width;
    });
    this.drawRule();
  }

  private drawHeading(value: string): void {
    this.ensureSpace(20);
    this.doc.y += 2;
    this.context = 'a section heading';
    this.text(value, {
      width: this.contentWidth,
      fontSize: 10,
      style: 'bold',
      color: INK,
    });
    this.doc.y += 2;
  }

  private drawBarChart(section: PdfBarChart): void {
    this.drawHeading(section.title);
    const prepared = prepareSeries(section.points, section.maxBars);
    if (prepared.points.length === 0) {
      this.drawNoData();
      return;
    }
    this.ensureSpace(BAR_CHART_HEIGHT + 34);
    const box = {
      x: MARGIN,
      y: this.doc.y,
      width: this.contentWidth,
      height: BAR_CHART_HEIGHT,
      padding: PLOT_PADDING,
    };
    const geometry = barChartGeometry(prepared.points, box);
    if (!geometry) {
      this.drawNoData();
      return;
    }
    this.drawFrame(geometry);
    for (const mark of geometry.marks) {
      // A zero value has no height by design; a hairline would make a real zero
      // indistinguishable from a tiny value.
      if (mark.height <= 0) continue;
      this.doc.rect(mark.x, mark.y, mark.width, mark.height).fill(ACCENT);
    }
    this.drawTicks(geometry, section.unit);
    this.drawCategoryLabels(
      geometry,
      prepared.points.map((p) => p.label),
      7,
    );
    this.doc.y = box.y + box.height + 4;
    this.drawDisclosure(prepared.omittedInvalid, prepared.omittedByCap, 'points');
  }

  private drawLineChart(section: PdfLineChart): void {
    this.drawHeading(section.title);
    const prepared = prepareSeries(section.points, section.maxPoints);
    if (prepared.points.length === 0) {
      this.drawNoData();
      return;
    }
    this.ensureSpace(LINE_CHART_HEIGHT + 34);
    const box = {
      x: MARGIN,
      y: this.doc.y,
      width: this.contentWidth,
      height: LINE_CHART_HEIGHT,
      padding: PLOT_PADDING,
    };
    const geometry = lineChartGeometry(prepared.points, box);
    if (!geometry) {
      this.drawNoData();
      return;
    }
    this.drawFrame(geometry);
    const path = geometry.path;
    if (path.length === 1) {
      const only = path[0] as { x: number; y: number };
      this.doc.circle(only.x, only.y, 2.5).fill(ACCENT);
    } else {
      const first = path[0] as { x: number; y: number };
      this.doc.moveTo(first.x, first.y);
      for (const point of path.slice(1)) this.doc.lineTo(point.x, point.y);
      this.doc.lineWidth(1.2).strokeColor(ACCENT).stroke();
      for (const point of path) this.doc.circle(point.x, point.y, 1.6).fill(ACCENT);
    }
    this.drawTicks(geometry, section.unit);
    this.drawCategoryLabels(
      geometry,
      prepared.points.map((p) => p.label),
      6,
    );
    this.doc.y = box.y + box.height + 4;
    this.drawDisclosure(prepared.omittedInvalid, prepared.omittedByCap, 'points');
  }

  /**
   * The "no data" state, written in words on purpose. An empty plot area is
   * indistinguishable from a plot of zeroes, and those are different facts
   * about a hospital's activity.
   */
  private drawNoData(): void {
    this.ensureSpace(30);
    const height = 24;
    this.doc.rect(MARGIN, this.doc.y, this.contentWidth, height).fill(TABLE_BAND_BG);
    this.context = 'the no-data notice';
    this.text('No data available for this period.', {
      x: MARGIN + 8,
      y: this.doc.y + 7,
      width: this.contentWidth - 16,
      fontSize: 8.5,
      style: 'italic',
      color: MUTED,
    });
    this.doc.y += height + 4;
  }

  /** State the omissions. Silence here would misrepresent completeness. */
  private drawDisclosure(
    omittedInvalid: number,
    omittedByCap: number,
    unit: string,
  ): void {
    const parts: string[] = [];
    if (omittedInvalid > 0) {
      parts.push(
        `${omittedInvalid} ${unit} omitted because the value was not a finite number`,
      );
    }
    if (omittedByCap > 0) {
      parts.push(
        `${omittedByCap} further ${unit} not shown because the chart display limit was reached`,
      );
    }
    if (parts.length === 0) return;
    this.ensureSpace(14);
    this.context = 'the chart omission note';
    this.text(`${parts.join('; ')}.`, {
      width: this.contentWidth,
      fontSize: 7.5,
      style: 'italic',
      color: MUTED,
    });
  }

  private drawFrame(geometry: ChartGeometry): void {
    this.doc
      .moveTo(geometry.left, geometry.top)
      .lineTo(geometry.right, geometry.top)
      .lineTo(geometry.right, geometry.bottom)
      .lineTo(geometry.left, geometry.bottom)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    if (geometry.yMin < 0 && geometry.yMax > 0) {
      this.doc
        .moveTo(geometry.left, geometry.zeroY)
        .lineTo(geometry.right, geometry.zeroY)
        .lineWidth(0.5)
        .strokeColor('#9ca3af')
        .stroke();
    }
  }

  private drawTicks(geometry: ChartGeometry, unit?: string): void {
    for (const tick of geometry.ticks) {
      this.context = 'a chart axis label';
      this.text(formatTick(tick, unit), {
        x: MARGIN,
        y: mapTick(geometry, tick) - 4,
        width: geometry.left - MARGIN - 6,
        fontSize: 7,
        align: 'right',
        color: MUTED,
      });
    }
  }

  /**
   * Category labels below the plot. When they will not all fit, every n-th is
   * drawn rather than letting them overlap into an unreadable band.
   */
  private drawCategoryLabels(
    geometry: ChartGeometry,
    labels: string[],
    fontSize: number,
  ): void {
    const count = labels.length;
    if (count === 0) return;
    const slot = geometry.width / count;
    const measured = labels.map((label) => ({
      label,
      width: this.doc
        .font(this.fontFor('regular').name)
        .fontSize(fontSize)
        .widthOfString(label),
    }));
    const widest = measured.reduce((max, entry) => Math.max(max, entry.width), 0);
    const step =
      (widest + 4) * count <= geometry.width
        ? 1
        : Math.max(1, Math.ceil(((widest + 4) * count) / geometry.width));
    this.context = 'a chart category label';
    const right = MARGIN + this.contentWidth;
    measured.forEach((entry, index) => {
      if (index % step !== 0 && index !== count - 1) return;
      // The label box is centred on its point, so it can hang outside the
      // content column — badly so for a chart with one or two points, where a
      // slot is the whole width. Clamp it back inside the margins.
      const centre = geometry.left + index * slot + slot / 2;
      let x = centre - slot;
      let width = slot * 2;
      if (x < MARGIN) {
        width -= MARGIN - x;
        x = MARGIN;
      }
      if (x + width > right) width = Math.max(12, right - x);
      this.text(entry.label, {
        x,
        y: geometry.bottom + 5,
        width,
        fontSize,
        align: 'center',
        color: MUTED,
        lineBreak: false,
        ellipsis: true,
      });
    });
  }

  private drawImage(section: PdfImage): void {
    const size = inspectImage(section.data, section.format);
    if (section.caption) this.drawHeading(section.caption);
    const available = this.pageBottom - this.doc.y;
    const drawn = fitWithin(
      { width: size.width, height: size.height },
      {
        width: section.width ?? this.contentWidth,
        height: section.height ?? Math.max(32, available - 6),
      },
    );
    this.ensureSpace(drawn.height + 6);
    this.doc.image(section.data, MARGIN, this.doc.y, {
      width: drawn.width,
      height: drawn.height,
    });
    this.doc.y += drawn.height + 6;
  }

  private drawFooter(): void {
    if (!this.spec.footer && !this.spec.pageNumbers) return;
    const range = this.doc.bufferedPageRange();
    const total = range.count;
    for (let index = range.start; index < range.start + total; index += 1) {
      this.doc.switchToPage(index);
      const y = this.pageSize.height - MARGIN + 4;
      this.drawRule();
      const parts: string[] = [];
      if (this.spec.footer) parts.push(this.spec.footer);
      if (this.spec.pageNumbers)
        parts.push(`Page ${index - range.start + 1} of ${total}`);
      this.context = 'the page footer';
      this.text(parts.join('   ·   '), {
        x: MARGIN,
        y: y + 4,
        width: this.contentWidth,
        fontSize: 7.5,
        color: MUTED,
        align: 'right',
      });
    }
  }
}

function mapTick(geometry: ChartGeometry, value: number): number {
  const span = geometry.yMax - geometry.yMin;
  if (span === 0) return geometry.bottom;
  const ratio = (value - geometry.yMin) / span;
  return geometry.bottom - ratio * (geometry.bottom - geometry.top);
}

function formatTick(value: number, unit?: string): string {
  const magnitude = Math.abs(value);
  const text =
    magnitude >= 10000
      ? `${Number((value / 1000).toFixed(1))}k`
      : Number.isInteger(value)
        ? String(value)
        : String(Number(value.toFixed(2)));
  return unit ? `${text} ${unit}` : text;
}

function normaliseCells(cells: string[], columnCount: number): string[] {
  const out = cells
    .slice(0, columnCount)
    .map((cell) => (cell == null ? '' : String(cell)));
  while (out.length < columnCount) out.push('');
  return out;
}
