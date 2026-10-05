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
/**
 * Staff routes require a confirmed session (see StaffGate), so a visitor with no
 * session sees the signed-out page rather than the shell. The stub upstream hands
 * one out, which is what keeps the shell itself under test.
 */
const ROUTES = [
  { path: '/design-system', name: 'careOS design system' },
  { path: '/', name: 'Overview' },
  { path: '/triage', name: 'Triage queue' },
  // Named by their real h1, not by what the route is called. On a patient record
  // the heading is the patient — that is the design decision under review — and
  // on the board it is whatever the clinic called itself.
  { path: '/triage/EX-0001', name: 'EXAMPLE Achieng Otieno' },
  { path: '/display', name: 'Outpatient clinics' },
  { path: '/request', name: 'Emergency care' },
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

test.describe('public emergency intake', () => {
  test('never presents a submission as an assessment', async ({ page }) => {
    await page.goto('/request');
    await expect(page.getByText(/has not been assessed/i)).toHaveCount(0);

    await page.getByLabel(/facility/i).selectOption('fac-example-1');
    await page.getByLabel(/patient name/i).fill('EXAMPLE Test Person');
    await page.getByLabel(/phone number/i).fill('+254700000000');
    await page.getByLabel(/what has happened/i).fill('EXAMPLE symptom description for a test.');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /send request/i }).click();

    // The contract is explicit that the receipt must not imply triage. Assert the
    // absence of the language that would imply it, which is the whole point.
    const receipt = page.getByText('EX-EM-00001');
    await expect(receipt).toBeVisible();
    await expect(page.getByText(/has not been assessed/i)).toBeVisible();
    await expect(page.getByText(/queue position|estimated wait|you will be seen/i)).toHaveCount(0);
  });

  test('does not pre-tick consent', async ({ page }) => {
    // Pre-ticked consent is not consent.
    await page.goto('/request');
    await expect(page.getByRole('checkbox')).not.toBeChecked();
  });

  test('explains a rate limit without mentioning the diagnostic message', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'careos-e2e', value: 'rate-limited', url: 'http://127.0.0.1:3100' }]);
    await page.goto('/request');
    await page.getByLabel(/facility/i).selectOption('fac-example-1');
    await page.getByLabel(/patient name/i).fill('EXAMPLE Test Person');
    await page.getByLabel(/phone number/i).fill('+254700000000');
    await page.getByLabel(/what has happened/i).fill('EXAMPLE symptom description for a test.');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /send request/i }).click();

    // Next injects its own role="alert" route announcer, so the assertion is scoped
    // by text rather than taking the first alert on the page.
    await expect(page.getByRole('alert').filter({ hasText: /too many requests/i })).toBeVisible();
    // The API's diagnostic `message` is not written for display and must not render.
    await expect(page.getByText('stub')).toHaveCount(0);
  });
});

test.describe('staff session gate', () => {
  test('shows staff content once a session is confirmed', async ({ page }) => {
    await page.goto('/triage');
    // The rail only exists inside the gate, so its presence is proof the content
    // behind it rendered.
    await expect(page.getByRole('navigation', { name: 'Clinical' })).toBeVisible();
    await expect(page.getByText('EXAMPLE Dr N. Wanjiru')).toBeVisible();
  });

  test('withholds staff content when there is no session', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'careos-e2e', value: 'signed-out', url: 'http://127.0.0.1:3100' }]);
    await page.goto('/triage');

    await expect(page.getByRole('heading', { name: 'Please sign in again' })).toBeVisible();

    // The actual assertion: the thing behind the gate must not be in the document
    // at all. Visible-but-covered would still leak it to a screen reader.
    await expect(page.getByRole('navigation', { name: 'Clinical' })).toHaveCount(0);
    await expect(page.getByText('EXAMPLE Achieng Otieno')).toHaveCount(0);
  });

  test('treats a failing API as signed out, and says so differently', async ({ page }) => {
    // Fails closed: if the session cannot be confirmed, staff content must not
    // render. And the message must not tell a clinician to sign in when the real
    // problem is that the service is down.
    await page
      .context()
      .addCookies([{ name: 'careos-e2e', value: 'unavailable', url: 'http://127.0.0.1:3100' }]);
    await page.goto('/triage');

    await expect(page.getByRole('navigation', { name: 'Clinical' })).toHaveCount(0);
    // A 503 is retryable, so the query backs off before it settles. That is correct
    // behaviour for the app; the assertion just has to wait for it rather than
    // racing it.
    await expect(
      page.getByRole('heading', { name: 'Service temporarily unavailable' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Please sign in again' })).toHaveCount(0);
  });
});
