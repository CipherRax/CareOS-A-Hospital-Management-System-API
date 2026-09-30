/**
 * Font resolution and glyph coverage for PDF rendering.
 *
 * Why a hand-written cmap parser: PDFKit silently drops any character the
 * embedded font lacks. No exception, no warning — a patient name written in a
 * script outside the font's coverage becomes a blank gap in a clinical
 * document, and a missing lab unit is worse than a visibly wrong one. Since
 * correctness here means *noticing* that corruption, coverage has to be checked
 * before rendering, and the only way to check it is to read the font's own
 * character map.
 *
 * Only what coverage checking needs is parsed: the table directory and the
 * `cmap` subtable (formats 4 and 12, which is what covers the BMP and the
 * astral planes). Hinting, layout tables, and outlines are ignored.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MissingGlyphError, PdfRenderError } from './pdf-errors';

// Not named `require`: TypeScript reserves that name in module top-level scope.
const nodeRequire = createRequire(__filename);

export type PdfFontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono';

/** Logical font names handed to PDFKit's `doc.font()`. */
export const PDF_FONT_NAMES: Record<PdfFontStyle, string> = {
  regular: 'careosBody',
  bold: 'careosBold',
  italic: 'careosOblique',
  boldItalic: 'careosBoldOblique',
  mono: 'careosMono',
};

const DEJAVU_FILES: Record<PdfFontStyle, string> = {
  regular: 'DejaVuSans.ttf',
  bold: 'DejaVuSans-Bold.ttf',
  italic: 'DejaVuSans-Oblique.ttf',
  boldItalic: 'DejaVuSans-BoldOblique.ttf',
  mono: 'DejaVuSansMono.ttf',
};

/**
 * Overrides the directory the TTFs are loaded from, for deployments that stage
 * fonts outside node_modules. Each variable names one face, so a site can
 * substitute a licensed font face-by-face rather than all-or-nothing.
 */
const FONT_PATH_ENV: Record<PdfFontStyle, string> = {
  regular: 'PDF_FONT_REGULAR',
  bold: 'PDF_FONT_BOLD',
  italic: 'PDF_FONT_ITALIC',
  boldItalic: 'PDF_FONT_BOLD_ITALIC',
  mono: 'PDF_FONT_MONO',
};

const FALLBACK_STYLE: Record<PdfFontStyle, PdfFontStyle> = {
  regular: 'regular',
  bold: 'bold',
  italic: 'italic',
  boldItalic: 'boldItalic',
  mono: 'regular',
};

export interface ResolvedFont {
  style: PdfFontStyle;
  name: string;
  path: string;
  coverage: GlyphCoverage;
}

let cache: Map<PdfFontStyle, ResolvedFont> | null = null;

/** Absolute path for a face, or null when it cannot be located. */
export function fontPath(style: PdfFontStyle): string | null {
  const override = process.env[FONT_PATH_ENV[style]];
  if (override) {
    try {
      readFileSync(override);
      return override;
    } catch (error) {
      // A font that was configured explicitly and cannot be read is a hard
      // error, not a reason to fall back. A deployment that points at a
      // licensed font and then loses the file would otherwise start emitting
      // documents in a different face with no signal that anything is wrong.
      throw new PdfRenderError(
        `Cannot read the PDF font configured in ${FONT_PATH_ENV[style]} (${override}). ` +
          'Fix the path or unset the variable to use the bundled font.',
        { cause: error },
      );
    }
  }
  try {
    return nodeRequire.resolve(`dejavu-fonts-ttf/ttf/${DEJAVU_FILES[style]}`);
  } catch {
    return null;
  }
}

export function loadFonts(): Map<PdfFontStyle, ResolvedFont> {
  if (cache) return cache;
  const loaded = new Map<PdfFontStyle, ResolvedFont>();
  for (const style of Object.keys(DEJAVU_FILES) as PdfFontStyle[]) {
    const path = fontPath(style);
    if (!path) {
      const fallback = FALLBACK_STYLE[style];
      if (fallback === style) {
        throw new Error(
          `PDF font not found for "${style}". Install the dejavu-fonts-ttf package or set ` +
            `${FONT_PATH_ENV[style]} to a .ttf file. Reports cannot be rendered without a ` +
            'font, because a WinAnsi substitute would silently drop non-Latin characters.',
        );
      }
      const fallbackPath = fontPath(fallback);
      if (!fallbackPath) {
        throw new Error(
          `PDF font not found for "${style}" or its fallback "${fallback}".`,
        );
      }
      const data = readFileSync(fallbackPath);
      loaded.set(style, {
        style,
        name: PDF_FONT_NAMES[style],
        path: fallbackPath,
        coverage: parseCmap(data),
      });
      continue;
    }
    const data = readFileSync(path);
    loaded.set(style, {
      style,
      name: PDF_FONT_NAMES[style],
      path,
      coverage: parseCmap(data),
    });
  }
  cache = loaded;
  return loaded;
}

/** Test seam: forget resolved fonts so a changed environment takes effect. */
export function resetFontCache(): void {
  cache = null;
}

export interface GlyphCoverage {
  /** Whether the font has a glyph for a code point. */
  has(codePoint: number): boolean;
  /** The first code point in `text` with no glyph, or null when all are covered. */
  firstMissing(text: string): number | null;
  /** Every distinct uncovered code point in `text`, in order of appearance. */
  missingIn(text: string): number[];
}

function parseCmap(data: Buffer): GlyphCoverage {
  const ranges: Array<{ start: number; end: number }> = [];
  try {
    readCmapRanges(data, ranges);
  } catch {
    // An unreadable cmap means "assume nothing is covered": the strict check
    // then fails loudly and a caller can turn it off, rather than the font
    // silently rendering blanks.
    ranges.push({ start: -1, end: -1 });
  }
  // Sort and merge so lookup is a binary search rather than a scan of a few
  // hundred segments for every character of every document.
  const sorted = mergeRanges(ranges);
  const has = (codePoint: number): boolean => {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const range = sorted[mid] as { start: number; end: number };
      if (codePoint < range.start) high = mid - 1;
      else if (codePoint > range.end) low = mid + 1;
      else return true;
    }
    return false;
  };
  return {
    has,
    firstMissing: (text) => missingIn(text, has)[0] ?? null,
    missingIn: (text) => missingIn(text, has),
  };
}

function mergeRanges(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const usable = ranges
    .filter((r) => r.start >= 0 && r.end >= r.start)
    .sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  for (const range of usable) {
    const last = out[out.length - 1];
    // Adjacent segments are common in format 4; merging keeps the search array small.
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

function missingIn(text: string, has: (codePoint: number) => boolean): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint === 0x20) continue;
    if (has(codePoint) || seen.has(codePoint)) continue;
    seen.add(codePoint);
    out.push(codePoint);
  }
  return out;
}

function readCmapRanges(data: Buffer, out: Array<{ start: number; end: number }>): void {
  if (data.length < 12) return;
  const numTables = data.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (record + 16 > data.length) break;
    if (data.toString('ascii', record, record + 4) === 'cmap') {
      cmapOffset = data.readUInt32BE(record + 8);
      break;
    }
  }
  if (cmapOffset < 0 || cmapOffset + 4 > data.length) return;

  const numSubtables = data.readUInt16BE(cmapOffset + 2);
  const chosen = new Map<number, number>();
  for (let i = 0; i < numSubtables; i += 1) {
    const record = cmapOffset + 4 + i * 8;
    if (record + 8 > data.length) break;
    const platform = data.readUInt16BE(record);
    const encoding = data.readUInt16BE(record + 2);
    const offset = cmapOffset + data.readUInt32BE(record + 4);
    if (offset + 4 > data.length) continue;
    const format = data.readUInt16BE(offset);
    // Prefer full-repertoire (format 12) and Unicode-platform subtables; keep
    // BMP-only format 4 as a fallback for fonts that ship no format 12.
    const rank =
      format === 12 ? 3 : format === 4 ? (platform === 3 && encoding === 1 ? 2 : 1) : 0;
    if (rank === 0) continue;
    const key = format === 12 ? 12 : 4;
    if ((chosen.get(key) ?? 0) >= rank) continue;
    chosen.set(key, rank);
    if (format === 12) {
      readFormat12(data, offset, out);
    } else if (out.length === 0) {
      readFormat4(data, offset, out);
    }
  }
}

function readFormat4(
  data: Buffer,
  offset: number,
  out: Array<{ start: number; end: number }>,
): void {
  const segCountX2 = data.readUInt16BE(offset + 6);
  const segCount = segCountX2 / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCountX2 + 2;
  for (let i = 0; i < segCount; i += 1) {
    const start = data.readUInt16BE(startCodes + i * 2);
    const end = data.readUInt16BE(endCodes + i * 2);
    // 0xFFFF is the mandatory final sentinel, not a real character.
    if (start > end || start === 0xffff) continue;
    out.push({ start, end });
  }
}

function readFormat12(
  data: Buffer,
  offset: number,
  out: Array<{ start: number; end: number }>,
): void {
  const numGroups = data.readUInt32BE(offset + 12);
  const groups = offset + 16;
  const limit = Math.min(numGroups, 200_000);
  for (let i = 0; i < limit; i += 1) {
    const record = groups + i * 12;
    if (record + 12 > data.length) break;
    const start = data.readUInt32BE(record);
    const end = data.readUInt32BE(record + 4);
    if (start > end) continue;
    out.push({ start, end });
  }
}

/** Describe a code point for an error message: `U+65E5 (日)`. */
export function describeCodePoint(codePoint: number): string {
  const hex = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  const character = String.fromCodePoint(codePoint);
  const printable = /^\p{L}|\p{N}|\p{P}|\p{S}/u.test(character) ? ` (${character})` : '';
  return `${hex}${printable}`;
}

export { MissingGlyphError };
