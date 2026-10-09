# careOS design system

Clinical Editorial. Text-first, dense, calm, and border-led.

This document is the contract for how careOS looks. It exists so that "make it
feel more clinical" is answerable with a reference rather than an opinion, and so
that a reviewer can check a screen against something written down.

Phase F0 status: **review passed.** Reviewed in F12 against the live
`/design-system` surface, which demonstrates all twenty signature components.
What a review cannot assert by eye — contrast, focus geometry, the radius and
duration scales — is wired into the build via `npm run tokens:verify`, the
global focus rule, and the axe sweep of `/design-system` in all four theme and
density combinations (see `docs/design-review.md`).

Review the live result at `/design-system`. Every colour, radius and duration in
the product comes from this system.

---

## 1. Principles

1. **Text is the interface.** Clinical staff read more than they click. Type
   scale, tabular numerals and legibility outrank decoration.
2. **Dense is not cramped.** Compact density removes padding, never font size or
   line height. Density is a user preference, not an accessibility compromise.
3. **Borders carry structure.** Elevation is a surface value and a 1px rule. There
   is exactly one shadow in the system, and it is for things that genuinely float.
4. **Colour means one thing.** Each semantic colour maps to exactly one meaning
   and is never reused decoratively.
5. **Never colour alone.** Every status carries an icon or a label as well as a
   colour. This is a hard rule, not a preference.
6. **The patient layer is a different product.** Patients and family are not
   staff with bigger text. They get their own scale, targets and canvas.
7. **No clinical advice, ever.** The UI never diagnoses, triages, suggests
   treatment, or presents a number without its estimate metadata.

---

## 2. Colour

33 tokens, defined once in `src/design/tokens/palette.mts`. That file is the
single source of truth: `npm run tokens:build` generates the CSS, and
`npm run tokens:verify` fails the build on any contrast regression. Colour is
therefore impossible to add without also proving it is readable.

### 2.1 Surfaces

| Token                  | Light     | Dark      | Use                             |
| ---------------------- | --------- | --------- | ------------------------------- |
| `--c-canvas`           | `#F4F5F3` | `#0E1513` | Page background                 |
| `--c-surface`          | `#FFFFFF` | `#141D1A` | Cards, panels, tables           |
| `--c-surface-sunken`   | `#EDEFEC` | `#0B110F` | Wells, inset areas, table zebra |
| `--c-surface-raised`   | `#FFFFFF` | `#1B2622` | Popovers, dialogs, toasts       |
| `--c-surface-hover`    | `#F0F2EF` | `#1A2421` | Pointer hover                   |
| `--c-surface-selected` | `#E3F1EE` | `#12302B` | Selected row or option          |
| `--c-public-canvas`    | `#FBFAF7` | `#0E1513` | Patient-facing pages            |

### 2.2 Borders — three tiers, and the middle one matters

| Token         | Light     | Dark      | Use                                        |
| ------------- | --------- | --------- | ------------------------------------------ |
| `--c-border`  | `#D9DDD8` | `#26332F` | Dividers, table rules, card outlines       |
| `--c-strong`  | `#B9C0BA` | `#3A4A45` | Emphasised rules, column headers           |
| `--c-control` | `#7F857F` | `#6B7D77` | **The boundary of an interactive control** |

`border` and `strong` come from the brief and both fail WCAG 1.4.11
(1.37:1 and 1.86:1 on surface). That is fine for a divider — 1.4.11 governs the
boundary of a control, not a separator — and unacceptable for an input. So there
are three tiers, and `control` is the one an input, select or checkbox
must use. See §8.

### 2.3 Text

| Token           | Light     | Dark      | Use                               |
| --------------- | --------- | --------- | --------------------------------- |
| `--c-primary`   | `#14201C` | `#E6ECE9` | Body copy, values, headings       |
| `--c-secondary` | `#46554F` | `#A9B7B1` | Supporting copy, labels, metadata |
| `--c-tertiary`  | `#5E6C66` | `#8B9B94` | Timestamps, units, footnotes      |
| `--c-disabled`  | `#8A958F` | `#5F6C67` | Disabled controls only            |
| `--c-on-fill`   | `#FFFFFF` | `#04140F` | Label **on a filled control**     |

`on-fill` is the load-bearing one. White on the dark-theme brand
(`#35B39E`) is 2.59:1 — unusable. Dark theme fills take near-black ink instead.

### 2.4 Brand

`--c-brand` `#0B6B5D` / `#35B39E`, with `--c-brand-hover`, `--c-brand-active`,
and `--c-brand-subtle` `#E3F1EE` / `#12302B`.

Brand as a fill takes `on-fill`. Brand as text uses `--c-brand-ink`, which is
asserted separately because the pair that works on white does not automatically
work on `brand-subtle`.

The staff theme is intended to be light. Dark is fully supported and contrast-
verified, not merely inverted.

### 2.5 Status

Each status has a text colour and a tint background, asserted as a pair in both
themes.

| Status   | Light text / bg       | Dark text / bg        |
| -------- | --------------------- | --------------------- |
| Critical | `#B42318` / `#FDECEA` | `#F97066` / `#3A1512` |
| Warning  | `#B54708` / `#FEF0C7` | `#FDB022` / `#3A2A0A` |
| Success  | `#067647` / `#E4F5EC` | `#47CD89` / `#0F2A1D` |
| Info     | `#175CD3` / `#E8F0FE` | `#84ADFF` / `#12203D` |

A status chip is always `bg` + text + icon or label. Colour alone is never
sufficient. Use `Badge` with a `tone`; do not hand-roll a chip.

### 2.6 Focus

`--c-focus-ring` shares the brand hue but is asserted independently: WCAG 2.4.11
requires 3:1 against _every_ adjacent colour, including sunken and raised
surfaces, which brand-on-surface alone does not guarantee.

Focus is styled **once, globally**, in `globals.css`. Components never restate it.
This is why focus treatment cannot drift between screens.

---

## 3. Type

IBM Plex Sans for everything structural, IBM Plex Mono for identifiers and
reference numbers, Source Serif 4 for patient-facing prose only. All
self-hosted via `@fontsource` — no external font CDN, because clinical software
must not depend on a third party being reachable.

### 3.1 Staff scale (default, 16px root)

| Token             | Size | Use                                         |
| ----------------- | ---- | ------------------------------------------- |
| `text-caption`    | 12px | Legal line, hints, footnotes                |
| `text-meta`       | 13px | Timestamps, counts, units, secondary labels |
| `text-body`       | 14px | Default body copy                           |
| `text-heading-xs` | 16px | Panel and card titles                       |
| `text-heading-sm` | 18px | Section headings                            |
| `text-heading`    | 22px | Page titles                                 |
| `text-heading-lg` | 28px | Reserved for the public layer               |

### 3.2 Public scale (18px base)

`text-public-body` 18px, `text-public-small` 17px, `text-public-caption` 15px,
`text-public-heading` 24px, `text-public-display` 32px.

17px rather than 16px on small phones: below that, body copy on a shared or older
device stops being comfortable, and the patient audience skews older.

### 3.3 Rules

- **Tabular numerals everywhere.** Set on `body`, not opted into. Clinical data is
  mostly numbers, and proportional digits make columns ragged. `tabular-nums` on
  any number is not optional.
- **Weights 400 / 500 / 600 only.** No 700. Heavier weights read as shouting in a
  quiet interface.
- **No uppercase labels and no letter-spaced small text.** The only tracking token
  is `--tracking-display`, for large text where it genuinely aids legibility.
- **Mono for identifiers**: patient reference, invoice numbers, UUIDs, vitals
  readouts, timestamps in tables.

---

## 4. Shape, elevation, motion

**Radius: 2 / 3 / 4px only.** Nothing in the shared staff layer exceeds 4px. The
brief's 8px public radius lives in `--radius-public`, deliberately _outside_ the
Tailwind `@theme` block, so a staff component cannot reach it by accident. Public
components opt in explicitly.

`--radius-full` exists for status dots and shape swatches. Not for cards.

**Elevation: borders and surface value.** One shadow in the entire system:

```
--shadow-overlay: 0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.12);
```

Reserved for popovers, dialogs and toasts. Panels, cards and table rows never get
a shadow — on a dense screen, stacked shadows make rows harder to track.

**Motion: 120ms and 180ms, and nothing else.** The brief bans 400–600ms, so those
values are simply not expressible: no token exists for them.
`prefers-reduced-motion` collapses both to 0ms, so state changes still register
without vestibular triggers.

`--shadow-overlay` is removed under `forced-colors: active`, since author
colours are dropped and the border must carry structure alone.

---

## 5. Density

Two densities, and only two.

| Property        | Comfortable | Compact |
| --------------- | ----------- | ------- |
| Control height  | 40px        | 32px    |
| Row height      | 44px        | 34px    |
| Control padding | 12px        | 10px    |
| Row padding     | 16px        | 12px    |
| Section gap     | 24px        | 16px    |
| Field gap       | 20px        | 16px    |

Components never hard-code a pixel height. They consume `--control-height`,
`--row-height` and friends, so switching density resizes the entire product at
once and no component can be left behind.

Density is persisted in a cookie read server-side, so `<html>` carries
`data-density` in the first response and there is no layout shift on reload.

**Density never changes type size.** Compressing type to gain density defeats a
text-first interface and quietly breaks WCAG 1.4.4 for anyone who has raised their
browser's default size.

The public layer ignores staff density entirely: 18px type and 56px targets are
floors there, not preferences.

---

## 6. Theming

`data-theme="light" | "dark"` on `<html>`, with `light`, `dark` and `system` as
user preferences stored in a cookie.

The server can read the cookie, so the correct theme is in the first paint — no
flash. The one value it cannot resolve is `system`, so the server emits light as
a deterministic baseline and a tiny inline script corrects it before paint.

Tailwind's `@theme inline` mapping is what makes the swap free: utilities point at
the custom property rather than baking in a value, so one attribute change
re-themes every utility at once with no duplicated class names.

---

## 7. Banned, with the reason

Not stylistic preferences. Each of these has caused a real defect in clinical
software.

| Banned                                     | Why                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Emoji                                      | Renders differently per platform, is read aloud nonsensically, and cannot be made to match a status icon's meaning |
| Gradients, glassmorphism, glow, neon       | Reduce text contrast, and the frosted-backdrop pattern is unreadable in bright clinical environments               |
| Generic KPI-card dashboards                | Implies a summary is available when the data underneath is not aggregated                                          |
| Stock medical imagery                      | Implies a clinical setting that does not exist; stock photos of smiling doctors are actively alienating            |
| Decorative icons                           | Visual noise competing with functional icons                                                                       |
| Rainbow status colours                     | Status colours are semantic; reusing them decoratively destroys the mapping                                        |
| Uppercase and letter-spaced labels         | Slows reading of dense text and is jargon for "styled"                                                             |
| Filler or playful microcopy                | In a tool people use under stress, "Oops!" costs trust                                                             |
| Inter/system fonts                         | Below the legibility bar for dense clinical data                                                                   |
| Emoji and icon-only buttons without labels | Unlabelled icon buttons are announced as just "button"                                                             |
| Colour-only validation                     | Fails 1.4.1 outright, and fails far worse in print and in glare                                                    |

---

## 8. Deliberate deviations from the brief

Each of these is a measured failure in the brief's stated palette, corrected and
verified rather than quietly dropped. All are asserted by
`npm run tokens:verify`, so they cannot regress.

| Token              | Brief         | Shipped               | Measured reason                                                                           |
| ------------------ | ------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `tertiary` (light) | `#6B7A73`     | `#5E6C66`             | 3.88:1 on sunken, 4.12:1 on canvas — below AA for real content                            |
| `tertiary` (dark)  | `#7C8B85`     | `#8B9B94`             | 3.97:1 on brand-subtle                                                                    |
| `control`          | _absent_      | `#7F857F` / `#6B7D77` | No brief token identifies a control at 3:1; inputs would be unusable for low-vision staff |
| `on-fill` (dark)   | white implied | `#04140F`             | White on dark brand is 2.59:1                                                             |
| `surface-raised`   | _absent_      | added                 | Popovers and dialogs need a surface that sits above canvas without shadow alone           |

Tertiary and control-border values were retuned in OKLab, preserving hue and
chroma, so the palette's character is intact while the contrast is fixed.

Corrections were made with margin, not to the bare minimum: the tightest passing
pair is 3.25:1 against a 3:1 requirement, so a later tweak to a neighbouring token
cannot silently push a pair under the line.

### Deliberate deviation: Next.js 16, not 15

The brief pins Next.js 15. `create-next-app` now scaffolds 16.3.8, and you chose
the current major. React 19, Tailwind v4 and the App Router are satisfied either
way. Two visible consequences: `middleware.ts` is now `proxy.ts` (Next 16 renamed
the convention), and Turbopack is the default bundler.

---

## 9. Review checklist

For any screen, in this order:

1. Does it work in **both** themes, with no unreadable text?
2. Does it work at **compact** density, with nothing clipped or overlapping?
3. Is every interactive boundary at least 3:1 (`control`, not `border`)?
4. Is every status communicated by **something other than colour**?
5. Is every number **tabular**, and does it carry its unit?
6. Is any focus ring visible on every background it lands on?
7. Does it avoid all of §7?
8. Would it be legible to someone squinting in sunlight on a matte screen?
