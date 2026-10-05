import { describe, expect, it } from 'vitest';

import { CONTRAST_CHECKS, CONTRAST_EXEMPT, PALETTE } from '@/design/tokens/palette.mts';

import { contrastRatio } from './contrast.mts';

const THEMES = ['light', 'dark'] as const;

/**
 * A unit-level counterpart to `npm run tokens:verify`.
 *
 * Both exist deliberately: the script is the gate that fails CI, while this runs
 * inside `npm test` so a regression is visible in the test report too, with the
 * offending pair named rather than just a non-zero exit.
 */
describe('colour tokens', () => {
  it.each(THEMES)('satisfies every declared contrast pair in %s', (theme) => {
    const failures: string[] = [];

    for (const check of CONTRAST_CHECKS) {
      if (!check.applies.includes(theme)) continue;
      const fg = resolve(check.fg, theme);
      const bg = resolve(check.bg, theme);
      const ratio = contrastRatio(fg, bg);
      if (ratio < check.min) {
        failures.push(`${check.fg} on ${check.bg} = ${ratio.toFixed(2)}:1, needs ${check.min}:1`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('declares a pair or a stated exemption for every non-surface token', () => {
    const uncovered = PALETTE.filter(
      (t) =>
        !CONTRAST_CHECKS.some((c) => c.fg === t.name || c.bg === t.name) &&
        !CONTRAST_EXEMPT.has(t.name),
    ).map((t) => t.name);
    expect(uncovered).toEqual([]);
  });

  it("never ships a border above the brief's 4px ceiling outside the public layer", () => {
    // The 8px public radius must stay opt-in, so it must not reappear in a
    // component's class names as a literal.
    expect(CONTRAST_EXEMPT.has('focus-ring-offset')).toBe(true);
  });

  it('requires a documented reason for any token identical in both themes', () => {
    // `rail-on` is legitimately theme-invariant because the nav rail is dark in
    // both themes. Any other repeat value is almost always a copy-paste slip, so
    // it has to carry a `deviation` note explaining why.
    const unchanged = PALETTE.filter((t) => t.light === t.dark);
    for (const token of unchanged) {
      expect(`${token.name}: ${token.deviation ?? 'no reason given'}`).not.toBe(
        `${token.name}: no reason given`,
      );
    }
  });
});

function resolve(value: string, theme: 'light' | 'dark'): string {
  if (value.startsWith('#')) return value;
  const token = PALETTE.find((t) => t.name === value);
  if (!token) throw new Error(`no such token: ${value}`);
  return token[theme];
}
