/**
 * Accessibility gate for colour. Asserts every pair in CONTRAST_CHECKS against
 * the palette and exits non-zero on any regression, so `npm run build` (via the
 * prebuild chain) cannot ship a palette that fails WCAG 2.2 AA.
 *
 * Run via `npm run tokens:verify`.
 *
 * The maths itself lives in src/design/tokens/contrast.mts so this script and the
 * unit tests cannot drift apart.
 */
import {
  CONTRAST_CHECKS,
  CONTRAST_EXEMPT,
  PALETTE,
  PALETTE_BY_NAME,
} from '../src/design/tokens/palette.mts';

import { contrastRatio } from '../src/design/tokens/contrast.mts';

function resolve(value, theme) {
  if (value.startsWith('#')) return value;
  const token = PALETTE_BY_NAME.get(value);
  if (!token) throw new Error(`no such token: ${value}`);
  return token[theme];
}

const failures = [];
const rows = [];

for (const check of CONTRAST_CHECKS) {
  for (const theme of check.applies) {
    let ratio;
    try {
      ratio = contrastRatio(resolve(check.fg, theme), resolve(check.bg, theme));
    } catch (err) {
      failures.push(`${theme}: ${err.message}`);
      continue;
    }
    const pass = ratio >= check.min;
    rows.push({ theme, fg: check.fg, bg: check.bg, ratio, min: check.min, pass, why: check.why });
    if (!pass) {
      failures.push(
        `${theme}: ${check.fg} on ${check.bg} = ${ratio.toFixed(2)}:1, needs ${check.min}:1 (${check.why})`,
      );
    }
  }
}

const worst = rows.reduce((acc, r) => (r.ratio < acc.ratio ? r : acc), rows[0]);

if (process.env.TOKENS_VERBOSE === '1') {
  for (const r of rows) {
    const mark = r.pass ? 'pass' : 'FAIL';
    console.log(
      `${r.theme.padEnd(5)} ${r.mark ?? mark} ${r.fg.padEnd(20)} on ${r.bg.padEnd(20)} ${r.ratio.toFixed(2).padStart(5)}:1  min ${r.min}  ${r.why}`,
    );
  }
}

// A colour with neither an asserted pair nor a stated exemption is the failure
// mode worth catching: someone added a token and never checked it.
const uncovered = PALETTE.filter(
  (t) =>
    !CONTRAST_CHECKS.some((c) => c.fg === t.name || c.bg === t.name) &&
    !CONTRAST_EXEMPT.has(t.name),
);

if (failures.length > 0) {
  console.error(`\ntokens:verify  ${failures.length} contrast failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

if (uncovered.length > 0) {
  console.error(
    `\ntokens:verify  ${uncovered.length} token(s) have neither a contrast pair nor a stated exemption:`,
  );
  for (const t of uncovered) console.error(`  - ${t.name} (${t.group})`);
  process.exit(1);
}

console.log(
  `tokens:verify  ${rows.length} pairs pass across ${PALETTE.length} tokens (${CONTRAST_EXEMPT.size} exempt by design); tightest is ${worst.theme} ${worst.fg} on ${worst.bg} at ${worst.ratio.toFixed(2)}:1 (min ${worst.min})`,
);
