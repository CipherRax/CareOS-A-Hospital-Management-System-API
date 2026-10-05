/**
 * careOS design tokens — single source of truth for colour.
 *
 * This module is data, not styling. `scripts/build-tokens.mjs` generates the
 * CSS custom properties and the Tailwind v4 `@theme inline` mapping from it, and
 * `scripts/verify-token-contrast.mjs` asserts every contrast pair declared in
 * `CONTRAST_CHECKS`. Editing values here changes the runtime CSS *and* the
 * accessibility gate at the same time, so the two can never drift.
 *
 * Source of the palette: the frontend brief, section 2.3, plus the public-layer
 * rules in section 2.6. Where a brief value failed WCAG 2.2 AA, the token below
 * carries a `deviation` note explaining the correction. See DESIGN.md
 * "Deliberate deviations from the brief".
 */

export type Theme = 'light' | 'dark';

export type TokenGroup =
  'surface' | 'border' | 'text' | 'brand' | 'status' | 'rail' | 'focus' | 'public';

export interface TokenDef {
  /** Suffix for the generated CSS custom property: `--c-<name>`. */
  readonly name: string;
  readonly group: TokenGroup;
  readonly light: string;
  readonly dark: string;
  /** Set when the value is not literally the brief's value. */
  readonly deviation?: string;
}

export const PALETTE: readonly TokenDef[] = [
  // ---------------------------------------------------------------- surfaces
  {
    name: 'canvas',
    group: 'surface',
    light: '#F4F5F3',
    dark: '#0E1513',
  },
  {
    name: 'surface',
    group: 'surface',
    light: '#FFFFFF',
    dark: '#141D1A',
  },
  {
    name: 'surface-sunken',
    group: 'surface',
    light: '#EDEFEC',
    dark: '#0B110F',
  },
  {
    name: 'surface-raised',
    group: 'surface',
    light: '#FFFFFF',
    dark: '#1B2622',
    deviation:
      'Brief names no overlay surface. Added for popovers, dialogs and toasts, which must sit above canvas and surface without relying on shadow alone.',
  },
  {
    name: 'surface-hover',
    group: 'surface',
    light: '#F0F2EF',
    dark: '#1A2421',
  },
  {
    name: 'surface-selected',
    group: 'surface',
    light: '#E3F1EE',
    dark: '#12302B',
  },

  // ----------------------------------------------------------------- borders
  {
    name: 'border',
    group: 'border',
    light: '#D9DDD8',
    dark: '#26332F',
    deviation:
      'Retained verbatim from the brief, but only for dividers, table rules and card outlines. Fails WCAG 1.4.11, so it must never be the sole boundary of an interactive control. Use `--c-control` for that.',
  },
  {
    name: 'strong',
    group: 'border',
    light: '#B9C0BA',
    dark: '#3A4A45',
    deviation:
      'Retained verbatim from the brief for emphasised rules and column headers. Fails WCAG 1.4.11; not valid as a control boundary.',
  },
  {
    name: 'control',
    group: 'border',
    light: '#7F857F',
    dark: '#6B7D77',
    deviation:
      'Derived. The brief has no border that identifies an interactive control at 3:1, so inputs, selects and checkboxes would have been unidentifiable to low-vision users. Tuned in OKLab from strong to clear 3:1 on canvas, surface, sunken and brand-subtle.',
  },

  // -------------------------------------------------------------------- text
  {
    name: 'primary',
    group: 'text',
    light: '#14201C',
    dark: '#E6ECE9',
  },
  {
    name: 'secondary',
    group: 'text',
    light: '#46554F',
    dark: '#A9B7B1',
  },
  {
    name: 'tertiary',
    group: 'text',
    light: '#5E6C66',
    dark: '#8B9B94',
    deviation:
      'Brief value #6B7A73 measures 3.88:1 on surface-sunken in light, and the dark counterpart measures 3.97:1 on brand-subtle — both below AA for real content. Both were retuned in OKLab (hue and chroma preserved) to clear 4.5:1 on all nine surfaces of their theme.',
  },
  {
    name: 'disabled',
    group: 'text',
    light: '#8A958F',
    dark: '#5F6C67',
    deviation:
      'Added. Disabled controls are exempt from 1.4.3, but this is kept distinct from tertiary so "disabled" is never confused with "low emphasis".',
  },
  {
    name: 'on-fill',
    group: 'text',
    light: '#FFFFFF',
    dark: '#04140F',
    deviation:
      'Derived. The brief implies white on brand, which is 2.59:1 against the dark-theme brand #35B39E. Dark theme uses near-black ink on its light fills instead: 7.28:1 on brand and 6.78-10.26:1 on the status fills.',
  },

  // ------------------------------------------------------------------- brand
  {
    name: 'brand',
    group: 'brand',
    light: '#0B6B5D',
    dark: '#35B39E',
  },
  {
    name: 'brand-hover',
    group: 'brand',
    light: '#095A4E',
    dark: '#4CC4AE',
  },
  {
    name: 'brand-active',
    group: 'brand',
    light: '#074C42',
    dark: '#5FD3BD',
  },
  {
    name: 'brand-subtle',
    group: 'brand',
    light: '#E3F1EE',
    dark: '#12302B',
  },
  {
    name: 'brand-ink',
    group: 'brand',
    light: '#0B6B5D',
    dark: '#35B39E',
    deviation:
      'Brand as readable text. Light 6.41:1 on white, 5.52:1 on brand-subtle; dark 5.46:1 on brand-subtle.',
  },

  // ------------------------------------------------------------------ status
  {
    name: 'status-critical',
    group: 'status',
    light: '#B42318',
    dark: '#F97066',
  },
  {
    name: 'status-critical-bg',
    group: 'status',
    light: '#FDECEA',
    dark: '#3A1512',
  },
  {
    name: 'status-warning',
    group: 'status',
    light: '#B54708',
    dark: '#FDB022',
  },
  {
    name: 'status-warning-bg',
    group: 'status',
    light: '#FEF0C7',
    dark: '#3A2A0A',
  },
  {
    name: 'status-success',
    group: 'status',
    light: '#067647',
    dark: '#47CD89',
  },
  {
    name: 'status-success-bg',
    group: 'status',
    light: '#E4F5EC',
    dark: '#0F2A1D',
  },
  {
    name: 'status-info',
    group: 'status',
    light: '#175CD3',
    dark: '#84ADFF',
  },
  {
    name: 'status-info-bg',
    group: 'status',
    light: '#E8F0FE',
    dark: '#12203D',
  },

  // ---------------------------------------------------------------- nav rail
  {
    name: 'rail',
    group: 'rail',
    light: '#0F2420',
    dark: '#0A1211',
  },
  {
    name: 'rail-on',
    group: 'rail',
    light: '#E6ECE9',
    dark: '#E6ECE9',
    deviation:
      'The rail is dark in both themes, so its foreground is theme-invariant. 13.56:1 light, 15.84:1 dark.',
  },
  {
    name: 'rail-on-muted',
    group: 'rail',
    light: '#9FB0A9',
    dark: '#93A49D',
  },

  // ------------------------------------------------------------------- focus
  {
    name: 'focus-ring',
    group: 'focus',
    light: '#0B6B5D',
    dark: '#35B39E',
    deviation:
      'Shares the brand hue but is asserted separately: WCAG 2.4.11 requires 3:1 against every adjacent colour, including sunken and raised surfaces.',
  },
  {
    name: 'focus-ring-offset',
    group: 'focus',
    light: '#FFFFFF',
    dark: '#0E1513',
  },

  // --------------------------------------------------------- public surface
  {
    name: 'public-canvas',
    group: 'public',
    light: '#FBFAF7',
    dark: '#0E1513',
    deviation:
      'Brief section 2.6 specifies a warm off-white public canvas. The dark value reuses the app dark canvas; no separate warm dark was specified.',
  },
];

export interface ContrastCheck {
  /** Token name, or a literal hex prefixed with `#`. */
  readonly fg: string;
  /** Token name, or a literal hex prefixed with `#`. */
  readonly bg: string;
  readonly min: number;
  readonly applies: readonly Theme[];
  readonly why: string;
}

/**
 * Every pair the accessibility gate enforces. Adding a colour without adding its
 * pairs is the failure mode this table exists to prevent.
 */
export const CONTRAST_CHECKS: readonly ContrastCheck[] = [
  // Body text on every surface it can legally sit on. 1.4.3 requires 4.5:1.
  ...(
    [
      ['surface', 'body text on cards, panels, dialogs'],
      ['canvas', 'body text on the page background'],
      ['surface-sunken', 'body text in wells, table zebra, inset areas'],
      ['surface-raised', 'body text in popovers and toasts'],
      ['public-canvas', 'body text on the patient-facing layer'],
      ['brand-subtle', 'body text inside brand tints'],
      ['status-critical-bg', 'body text inside a critical tint'],
      ['status-warning-bg', 'body text inside a warning tint'],
      ['status-success-bg', 'body text inside a success tint'],
      ['status-info-bg', 'body text inside an info tint'],
    ] as const
  ).flatMap(([bg, why]): ContrastCheck[] =>
    (['light', 'dark'] as const).map((t): ContrastCheck => ({
      fg: 'primary',
      bg,
      min: 4.5,
      applies: [t],
      why,
    })),
  ),

  ...(
    [
      ['surface', 'secondary labels and supporting copy'],
      ['canvas', 'secondary labels on the page background'],
      ['surface-sunken', 'secondary copy in wells and inset areas'],
      ['public-canvas', 'secondary copy on the patient-facing layer'],
    ] as const
  ).flatMap(([bg, why]): ContrastCheck[] =>
    (['light', 'dark'] as const).map((t): ContrastCheck => ({
      fg: 'secondary',
      bg,
      min: 4.5,
      applies: [t],
      why,
    })),
  ),

  // Tertiary text carries timestamps, units and footnotes — still real content,
  // so still 4.5:1. The brief's own value failed this; see the token note.
  ...(
    [
      ['surface', 'timestamps, units, footnotes'],
      ['canvas', 'timestamps on the page background'],
      ['surface-sunken', 'footnotes inside wells'],
      ['public-canvas', 'footnotes on the patient-facing layer'],
      ['brand-subtle', 'meta text inside brand tints'],
    ] as const
  ).flatMap(([bg, why]): ContrastCheck[] =>
    (['light', 'dark'] as const).map((t): ContrastCheck => ({
      fg: 'tertiary',
      bg,
      min: 4.5,
      applies: [t],
      why,
    })),
  ),

  // Interactive control boundaries. WCAG 1.4.11 requires 3:1.
  ...(
    [
      ['surface', 'input outlines on cards and panels'],
      ['canvas', 'input outlines on the page background'],
      ['surface-sunken', 'input outlines inside wells'],
      ['brand-subtle', 'input outlines inside brand tints'],
      ['public-canvas', 'input outlines on the patient-facing layer'],
    ] as const
  ).flatMap(([bg, why]): ContrastCheck[] =>
    (['light', 'dark'] as const).map((t): ContrastCheck => ({
      fg: 'control',
      bg,
      min: 3,
      applies: [t],
      why,
    })),
  ),

  // Focus ring against every surface it can appear on. WCAG 2.4.11.
  ...(
    [
      ['canvas', 'focus ring on the page background'],
      ['surface', 'focus ring on panels'],
      ['surface-sunken', 'focus ring inside wells'],
      ['public-canvas', 'focus ring on the patient-facing layer'],
    ] as const
  ).flatMap(([bg, why]): ContrastCheck[] =>
    (['light', 'dark'] as const).map((t): ContrastCheck => ({
      fg: 'focus-ring',
      bg,
      min: 3,
      applies: [t],
      why,
    })),
  ),

  // Foreground on a filled control. The button's whole job is this pair.
  {
    fg: 'on-fill',
    bg: 'brand',
    min: 4.5,
    applies: ['light', 'dark'],
    why: 'primary button label',
  },
  {
    fg: 'on-fill',
    bg: 'brand-hover',
    min: 4.5,
    applies: ['light', 'dark'],
    why: 'primary button label on hover',
  },
  {
    fg: 'on-fill',
    bg: 'brand-active',
    min: 4.5,
    applies: ['light', 'dark'],
    why: 'primary button label while pressed',
  },

  // Status text inside its own tint, and on plain surface.
  ...(['critical', 'warning', 'success', 'info'] as const).flatMap((s): ContrastCheck[] => [
    {
      fg: `status-${s}`,
      bg: `status-${s}-bg`,
      min: 4.5,
      applies: ['light', 'dark'],
      why: `${s} chip text on its tint`,
    },
    {
      fg: `status-${s}`,
      bg: 'surface',
      min: 4.5,
      applies: ['light', 'dark'],
      why: `${s} text used outside a chip`,
    },
    {
      fg: 'on-fill',
      bg: `status-${s}`,
      min: 4.5,
      applies: ['light', 'dark'],
      why: `label on a filled ${s} badge`,
    },
  ]),

  // Brand as a text colour, not a fill.
  {
    fg: 'brand-ink',
    bg: 'surface',
    min: 4.5,
    applies: ['light', 'dark'],
    why: 'brand-coloured links and emphasis text',
  },
  {
    fg: 'brand-ink',
    bg: 'brand-subtle',
    min: 4.5,
    applies: ['light', 'dark'],
    why: 'brand-coloured links inside a brand tint',
  },

  // Navigation rail.
  {
    fg: 'rail-on',
    bg: 'rail',
    min: 4.5,
    applies: ['light', 'dark'],
    why: 'primary nav item label',
  },
  {
    fg: 'rail-on-muted',
    bg: 'rail',
    min: 4.5,
    applies: ['light', 'dark'],
    why: 'secondary nav item label',
  },
];

export const PALETTE_BY_NAME: ReadonlyMap<string, TokenDef> = new Map(
  PALETTE.map((t) => [t.name, t]),
);

/**
 * Tokens that intentionally carry no asserted contrast pair. Listing them with a
 * reason keeps the "unpaired token" warning in the verifier meaningful: it should
 * only ever fire for a colour somebody added and forgot to think about.
 */
export const CONTRAST_EXEMPT: ReadonlyMap<string, string> = new Map([
  [
    'border',
    'Divider and table-rule colour only. WCAG 1.4.11 governs the boundary of a control, not a separator; using this as a control outline is the exact mistake control exists to prevent.',
  ],
  ['strong', 'Emphasised rule and column-header colour only, same reasoning as border.'],
  [
    'disabled',
    'Disabled controls are exempt from WCAG 1.4.3. Still must be distinguishable from tertiary so "disabled" is not mistaken for "low emphasis".',
  ],
  [
    'focus-ring-offset',
    'The gap between a focus ring and its control. Colour exists to match the surrounding surface, and is asserted indirectly by the focus-ring pairs.',
  ],
  [
    'surface-hover',
    'Pointer hover state. The row or control underneath supplies the asserted pair; this only shifts the backdrop.',
  ],
  [
    'surface-selected',
    'Selected row/option backdrop. The selected item inherits the text pairs of the surface it replaces.',
  ],
]);
