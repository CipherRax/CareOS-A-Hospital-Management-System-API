/**
 * Generates src/app/tokens.generated.css from src/design/tokens/palette.mts.
 *
 * Run via `npm run tokens:build`. Committed output is intentional: the CSS must
 * be reviewable in a diff, and `next build` must not depend on being able to
 * execute TypeScript at build time.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PALETTE } from '../src/design/tokens/palette.mts';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../src/app/tokens.generated.css');

const GROUP_ORDER = ['surface', 'border', 'text', 'brand', 'status', 'rail', 'focus', 'public'];

const GROUP_COMMENT = {
  surface: 'Surfaces. Elevation is expressed by surface value and a 1px rule, never by shadow.',
  border:
    'Borders. `border`/`border-strong` are rules only; `border-control` identifies interactive controls at 3:1.',
  text: 'Text. `text-on-fill` is the foreground for filled controls and differs per theme.',
  brand: 'Brand teal. As a fill it carries `text-on-fill`; as text use `brand-ink`.',
  status: 'Status. Always paired with an icon or label — never colour alone.',
  rail: 'Staff nav rail. Dark in both themes.',
  focus: 'Focus. Ring colour is asserted at 3:1 against every adjacent surface.',
  public: 'Patient-facing public layer (brief 2.6).',
};

function decl(name, theme) {
  return `  --c-${name}: ${theme};`;
}

function themeBlock(selector, theme, groups) {
  const lines = [selector + ' {'];
  for (const group of groups) {
    const tokens = PALETTE.filter((t) => t.group === group);
    if (tokens.length === 0) continue;
    lines.push(`  /* ${GROUP_COMMENT[group]} */`);
    for (const t of tokens) lines.push(decl(t.name, t[theme]));
    lines.push('');
  }
  lines.push('  color-scheme: ' + (theme === 'dark' ? 'dark' : 'light') + ';');
  lines.push('}');
  return lines.join('\n').trimEnd();
}

const groups = GROUP_ORDER.filter((g) => PALETTE.some((t) => t.group === g));

const header = `/* GENERATED FILE — do not edit by hand.
 * Source: src/design/tokens/palette.mts
 * Regenerate: npm run tokens:build
 * Verify:     npm run tokens:verify   (fails the gate on any contrast regression)
 */`;

const raw = [
  header,
  themeBlock(':root,\n[data-theme="light"]', 'light', groups),
  '',
  themeBlock('[data-theme="dark"]', 'dark', groups),
].join('\n\n');

const themeMap = [
  '/* Tailwind v4 @theme mapping.',
  ' * `inline` keeps each utility pointing at the custom property instead of',
  ' * baking in a value, so a [data-theme] swap re-themes every utility at once',
  ' * with no duplicated class names.',
  ' */',
  '@theme inline {',
  ...groups.map((g) => `  /* ${g} */`),
  ...PALETTE.filter((t) => groups.includes(t.group)).map(
    (t) => `  --color-${t.name}: var(--c-${t.name});`,
  ),
  '}',
].join('\n');

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${raw}\n\n${themeMap}\n`, 'utf8');

const derived = PALETTE.filter((t) => t.deviation).length;
console.log(
  `tokens:build  wrote ${PALETTE.length} tokens (${derived} deviating from the brief) -> src/app/tokens.generated.css`,
);
