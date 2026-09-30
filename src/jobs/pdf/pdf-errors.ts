/**
 * Errors raised while rendering a PDF.
 *
 * These are programming/configuration errors rather than user input errors: a
 * caller asking to render a document it built itself. They deliberately do not
 * extend `AppError`, because the API layer should not map them to a 4xx — if a
 * report can be built at all, it should be renderable, and a render failure
 * means the code or the deployment is wrong.
 *
 * `AppError` lives under `src/common`, which is below `src/jobs` in the layering
 * rules, so importing it here would invert the dependency direction.
 */

export class PdfRenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdfRenderError';
  }
}

/**
 * Raised when text cannot be drawn in full because the embedded font has no
 * glyph for it. Carries the offending code points so the fix is obvious.
 *
 * This is on by default. The alternative — render the document and drop the
 * characters — produces a report that looks complete and is not, which in a
 * clinical document is worse than a failed request.
 */
export class MissingGlyphError extends PdfRenderError {
  readonly codePoints: number[];
  /** What was being drawn, e.g. "a chart axis label". Never the string itself. */
  readonly context: string;

  constructor(codePoints: number[], context: string) {
    super(
      `Cannot render ${context}: the embedded PDF font has no glyph for ` +
        `${codePoints.map(describe).join(', ')}. ` +
        'Set PDF_FONT_* to a font with wider coverage, or correct the text.',
    );
    this.name = 'MissingGlyphError';
    this.codePoints = codePoints;
    this.context = context;
  }
}

function describe(codePoint: number): string {
  const hex = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  const character = String.fromCodePoint(codePoint);
  return /^\p{L}|\p{N}|\p{P}|\p{S}/u.test(character) ? `${hex} "${character}"` : hex;
}
