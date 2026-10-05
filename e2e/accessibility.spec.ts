import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Automated accessibility checks.
 *
 * axe catches roughly a third of real accessibility defects — missing names,
 * broken contrast, invalid ARIA. It cannot assess keyboard traversal order, focus
 * trapping, or whether a control is reachable at all. A passing axe run is
 * necessary and not sufficient, and is never evidence of WCAG conformance.
 * See docs/limitations.md.
 */

/** Themes and densities that every accessibility run must cover. */
const VARIANTS = [
  { theme: 'light', density: 'comfortable' },
  { theme: 'dark', density: 'comfortable' },
  { theme: 'light', density: 'compact' },
  { theme: 'dark', density: 'compact' },
] as const;

/**
 * Every route a user can reach. Swept in all four variants rather than spot
 * checking, because a status colour or a focus ring that fails in dark mode only
 * fails in dark mode.
 */
const ROUTES = [
  { path: '/design-system', name: 'careOS design system' },
  { path: '/', name: 'Overview' },
  { path: '/triage', name: 'Triage queue' },
] as const;

/**
 * Forces a theme and density via cookie, then reloads.
 *
 * Cookies rather than clicking the toggles, because this runs against a production
 * build and the point is to check the server-rendered result — the same bytes a
 * user receives — not to also test the toggle controls.
 */
async function applyVariant(page: Page, theme: string, density: string) {
  await page.context().addCookies([
    { name: 'careos-theme', value: theme, url: 'http://127.0.0.1:3100' },
    { name: 'careos-density', value: density, url: 'http://127.0.0.1:3100' },
  ]);
}

async function analyse(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
}

/** Flattens violations into a readable failure message. */
function describe(violations: Awaited<ReturnType<typeof analyse>>['violations']) {
  return violations
    .map((v) => {
      const targets = v.nodes
        .slice(0, 4)
        .map((n) => n.target.join(' '))
        .join('\n      ');
      return `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.length} node(s)\n      ${targets}`;
    })
    .join('\n\n');
}

for (const variant of VARIANTS) {
  test.describe(`${variant.theme} theme, ${variant.density} density`, () => {
    for (const route of ROUTES) {
      test(`${route.path} has no axe violations`, async ({ page }) => {
        await applyVariant(page, variant.theme, variant.density);
        await page.goto(route.path);
        await expect(page.getByRole('heading', { name: route.name, exact: true })).toBeVisible();

        const results = await analyse(page);
        expect(results.violations, describe(results.violations)).toEqual([]);
      });
    }
  });
}

test('the theme actually applied, in both directions', async ({ page }) => {
  // Guards against a false pass: if the theme never switched, every variant above
  // would have checked the same rendering and proved nothing about dark mode.
  await page
    .context()
    .addCookies([{ name: 'careos-theme', value: 'dark', url: 'http://127.0.0.1:3100' }]);
  await page.goto('/design-system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Scoped to the preference panel. The page also carries preview controls that
  // retheme only their own region, and clicking those proves nothing about the
  // document — a mistake this locator is written to prevent.
  const prefs = page.getByRole('region', { name: 'Your preference' });
  await prefs.getByRole('button', { name: 'light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'light');

  // And the choice must survive a reload, because it is stored in a cookie.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the preview region themes independently of the document', async ({ page }) => {
  // The preview panel re-themes only its own subtree. If it leaked to <html>, the
  // reviewer's chosen theme would silently change the visitor's real preference.
  await page.goto('/design-system');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'dark', exact: true }).last().click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('density persists across a reload, server-side', async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: 'careos-density', value: 'compact', url: 'http://127.0.0.1:3100' }]);
  await page.goto('/design-system');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

  // The attribute must already be correct in the first response, not applied by
  // hydration — otherwise there is a layout shift on every reload.
  const html = await page.content();
  expect(html).toContain('data-density="compact"');
});

test('every control is reachable and labelled by keyboard alone', async ({ page }) => {
  await page.goto('/design-system');

  // Tab through the page and confirm focus lands on real elements, never on the
  // document body — the usual symptom of a keyboard trap or a broken tab order.
  const reached: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return el.tagName.toLowerCase();
    });
    if (info === null) break;
    reached.push(info);
  }

  expect(reached.length).toBeGreaterThan(5);

  // Accessible names come from the ARIA snapshot, not from reading `aria-label`
  // or `textContent`. An input named by an associated <label> has neither, so a
  // hand-rolled check reports false positives — and, worse, would have masked the
  // genuinely nameless checkbox that this test was written to catch.
  const snapshot = await page.locator('main').ariaSnapshot();
  const interactive = snapshot
    .split('\n')
    .map((line) => line.trim())
    .filter((line) =>
      /^- (button|checkbox|textbox|combobox|slider|spinbutton|tab|menuitem)/.test(line),
    );

  expect(interactive.length).toBeGreaterThan(5);

  const unnamed = interactive.filter((line) => {
    const quoted = line.match(/"([^"]*)"/)?.[1];
    return (quoted ?? '').trim().length === 0;
  });

  expect(unnamed, `controls with no accessible name:\n${unnamed.join('\n')}`).toEqual([]);
});
