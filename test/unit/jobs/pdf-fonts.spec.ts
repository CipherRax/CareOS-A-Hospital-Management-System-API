import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  describeCodePoint,
  fontPath,
  loadFonts,
  resetFontCache,
} from '../../../src/jobs/pdf/pdf-fonts';
import { MissingGlyphError, PdfRenderError } from '../../../src/jobs/pdf/pdf-errors';

const nodeRequire = createRequire(__filename);

describe('fontPath', () => {
  it('resolves the vendored faces', () => {
    expect(fontPath('regular')).toContain('DejaVuSans.ttf');
    expect(fontPath('bold')).toContain('DejaVuSans-Bold.ttf');
  });

  it('prefers an explicit override over the bundled face', () => {
    const previous = process.env['PDF_FONT_REGULAR'];
    const bold = fontPath('bold') as string;
    process.env['PDF_FONT_REGULAR'] = bold;
    try {
      // A deployment substituting a licensed face must actually get it.
      expect(fontPath('regular')).toBe(bold);
      expect(fontPath('regular')).not.toBe(fontPath('italic'));
    } finally {
      if (previous === undefined) delete process.env['PDF_FONT_REGULAR'];
      else process.env['PDF_FONT_REGULAR'] = previous;
      resetFontCache();
    }
  });
});

describe('glyph coverage', () => {
  const fonts = loadFonts();
  const coverage = fonts.get('regular')!.coverage;

  it('covers the Latin-1 range, which the old Helvetica/WinAnsi path handled', () => {
    for (const character of 'abcXYZ0123456789.,-/()[]{}%&@#') {
      expect(coverage.has(character.codePointAt(0)!)).toBe(true);
    }
  });

  it('covers the medical symbols the old renderer turned into mojibake', () => {
    // These are the characters a lab result or a vital sign actually contains.
    // The pre-P10 writer emitted them as raw UTF-8 inside a WinAnsi font, so
    // `µmol/L` came out as broken bytes.
    for (const character of 'µ°≥≤±×÷') {
      expect(coverage.has(character.codePointAt(0)!)).toBe(true);
    }
  });

  it('covers accented Latin, diacritics, Greek and Cyrillic', () => {
    // CJK is deliberately absent from this list: DejaVu carries no ideographs,
    // which is what the next test pins down.
    for (const character of 'éüñçÅøΕλληνικάКириллица') {
      expect(coverage.has(character.codePointAt(0)!)).toBe(true);
    }
  });

  it('covers currency symbols a financial report needs', () => {
    for (const character of '€£₹') {
      expect(coverage.has(character.codePointAt(0)!)).toBe(true);
    }
  });

  it('does not claim coverage it lacks', () => {
    // CJK is the honest negative: DejaVu has no ideographs, and pretending
    // otherwise is what turns a name into a blank gap in a clinical document.
    expect(coverage.has('日'.codePointAt(0)!)).toBe(false);
    expect(coverage.missingIn('Invoice 日 42')).toEqual(['日'.codePointAt(0)!]);
  });

  it('ignores spaces when checking coverage', () => {
    expect(coverage.missingIn('   ')).toEqual([]);
    expect(coverage.missingIn('')).toEqual([]);
  });

  it('reports each missing code point once, in order of appearance', () => {
    expect(coverage.missingIn('日 本 日')).toEqual([
      '日'.codePointAt(0)!,
      '本'.codePointAt(0)!,
    ]);
  });

  it('has no coverage for a negative code point', () => {
    expect(coverage.has(-1)).toBe(false);
  });

  it('fails loudly when a configured font path cannot be read', () => {
    const previous = process.env['PDF_FONT_REGULAR'];
    process.env['PDF_FONT_REGULAR'] = '/nonexistent/careos-font.ttf';
    try {
      // Not a silent fallback: a deployment that points at a licensed font and
      // then loses the file must not start emitting documents in a different
      // face, which is the kind of change nobody notices until an audit.
      expect(() => fontPath('regular')).toThrow(PdfRenderError);
      expect(() => fontPath('regular')).toThrow(/PDF_FONT_REGULAR/);
    } finally {
      if (previous === undefined) delete process.env['PDF_FONT_REGULAR'];
      else process.env['PDF_FONT_REGULAR'] = previous;
      resetFontCache();
    }
  });
});

describe('loadFonts', () => {
  it('caches resolved fonts', () => {
    resetFontCache();
    const first = loadFonts();
    const second = loadFonts();
    expect(first).toBe(second);
  });

  it('registers a distinct document font name per style', () => {
    const names = new Set([...loadFonts().values()].map((font) => font.name));
    expect(names.size).toBeGreaterThanOrEqual(4);
  });
});

describe('describeCodePoint', () => {
  it('renders the hex and the character', () => {
    expect(describeCodePoint(0x65e5)).toContain('U+65E5');
    expect(describeCodePoint(0x65e5)).toContain('日');
  });

  it('omits a symbol it cannot print', () => {
    expect(describeCodePoint(0x0001)).toBe('U+0001');
  });
});

describe('MissingGlyphError', () => {
  it('names the offending characters and the place they came from', () => {
    const error = new MissingGlyphError([0x65e5], 'the report title');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('the report title');
    expect(error.message).toContain('U+65E5');
    expect(error.codePoints).toEqual([0x65e5]);
  });
});

describe('the real font file', () => {
  it('is a TrueType font large enough to carry the coverage claimed above', () => {
    // Guards the tests above: they are only meaningful against a real font and
    // would pass vacuously against a stub.
    const data = readFileSync(fontPath('regular') as string);
    expect(data.length).toBeGreaterThan(100_000);
    // sfnt version 0x00010000 is TrueType outlines.
    expect([data[0], data[1], data[2], data[3]]).toEqual([0x00, 0x01, 0x00, 0x00]);
    expect(nodeRequire.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')).toBe(
      fontPath('regular'),
    );
  });
});
