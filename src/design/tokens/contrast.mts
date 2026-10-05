/**
 * WCAG 2.x contrast maths.
 *
 * Lives in `src` rather than inside the verifier script because both the script
 * (the CI gate) and the unit tests need it, and two copies of a contrast formula
 * would eventually disagree about which one is correct.
 *
 * Implements the sRGB relative luminance definition from WCAG 2.2, with the
 * piecewise transfer function applied in the correct direction (linearise before
 * weighting — getting this backwards produces ratios that look plausible and are
 * wrong).
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToRgb(hex: string): readonly [number, number, number] {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) {
    throw new Error(`Expected a 6-digit hex colour, received: ${hex}`);
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio, 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Human-readable WCAG grade for a ratio, at AA for normal body text. */
export function wcagGrade(ratio: number): 'AAA' | 'AA' | 'AA Large' | 'Fail' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}
