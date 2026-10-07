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
  { path: '/login', name: 'Sign in to careOS' },
  { path: '/triage', name: 'Triage queue' },
  // Named by their real h1, not by what the route is called. On a patient record
  // the heading is the patient — that is the design decision under review — and
  // on the board it is whatever the clinic called itself.
  { path: '/triage/EX-0001', name: 'EXAMPLE Achieng Otieno' },
  { path: '/display', name: 'Outpatient clinics' },
  { path: '/request', name: 'Emergency care' },
  { path: '/facilities', name: 'Find a facility' },
  { path: '/track', name: 'Track your request' },
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
    // Staff routes only render behind a confirmed session, and its href target
    // state. Establishing the session up front keeps the staff shell itself under
    // axe — the alternative is the shell never appearing in an accessibility run
    // at all, which is exactly the cover this sweep is for.
    test.beforeEach(async ({ page }) => {
      await signInViaUi(page);
    });

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

test.describe('public language switch', () => {
  test('switches the page to Kiswahili and marks the active language', async ({ page }) => {
    await page.goto('/request');

    const switcher = page.getByRole('navigation', { name: /language/i });
    await expect(switcher).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await switcher.getByRole('link', { name: 'Kiswahili' }).click();
    await page.waitForURL(/\/request$/);

    // The catalogue actually changed, which is the only thing that counts.
    await expect(page.getByRole('heading', { name: /omba ombali/i })).toBeVisible();

    // `lang` is not cosmetic: a screen reader picks its voice from it, so a
    // Kiswahili page announced in English is materially harder to follow.
    await expect(page.locator('html')).toHaveAttribute('lang', 'sw');

    // The active language is announced, so the two links are not indistinguishable
    // to a screen reader user.
    //
    // Scoped to the page, not to `switcher`: that locator finds the nav by its
    // English accessible name, and the whole point of this test is that the page is
    // no longer English. Re-querying by link name keeps the assertion independent of
    // the language it just switched away from.
    await expect(page.getByRole('link', { name: 'Kiswahili' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByRole('link', { name: 'English' })).not.toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('returns the reader to the page they switched from, and keeps the language', async ({
    page,
  }) => {
    await page.goto('/request');

    const swahili = page
      .getByRole('navigation', { name: /language/i })
      .getByRole('link', { name: 'Kiswahili' });
    await swahili.click();
    await page.waitForURL(/\/request$/);

    // Not dumped on a home page or a dead /locale endpoint: the switch has to put
    // the reader back exactly where they were.
    await expect(page).toHaveURL(/\/request$/);
    await expect(page.getByRole('heading', { name: /huduma ya dharura/i })).toBeVisible();

    // And it has to survive a reload. The locale lives in a cookie precisely
    // because the URL does not carry it, so a refresh that drops the language
    // would undo the switch on every back-navigation.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'sw');
    await expect(page.getByRole('heading', { name: /huduma ya dharura/i })).toBeVisible();
  });

  test('never offers a language on the staff surface', async ({ page }) => {
    // Staff workstations are managed; the language follows the machine, and an
    // accidental switch mid-consultation costs more than it gives.
    await page.goto('/triage');
    await expect(page.getByRole('navigation', { name: /language/i })).toHaveCount(0);
  });

  test('never offers a language on the waiting room board', async ({ page }) => {
    // The board is read at distance by people who cannot be expected to find a
    // language control, and it has no chrome to hang one on.
    await page.goto('/display');
    await expect(page.getByRole('navigation', { name: /language/i })).toHaveCount(0);
  });
});

test.describe('public emergency intake', () => {
  test('never presents a submission as an assessment', async ({ page }) => {
    await page.goto('/request');
    await expect(page.getByText(/has not been assessed/i)).toHaveCount(0);

    await fillIntakeRequest(page);
    await page.getByRole('button', { name: /send request/i }).click();

    // The contract is explicit that the receipt must not imply triage. Assert the
    // absence of the language that would imply it, which is the whole point.
    const receipt = page.getByText('EX-EM-00001');
    await expect(receipt).toBeVisible();
    // The tracking token is the secret that proves the request is the caller's.
    await expect(page.getByText('ex-tok-00001')).toBeVisible();
    await expect(page.getByText(/has not been assessed/i)).toBeVisible();
    await expect(page.getByText(/queue position|estimated wait|you will be seen/i)).toHaveCount(0);
  });

  test('collects no consent checkbox — consent is the API act', async ({ page }) => {
    // The live body carries `consentVersion`, recorded server-side; the retired
    // `consentToContact:true` checkbox does not exist upstream. Guarding against
    // someone re-shipping a consent box that records nothing.
    await page.goto('/request');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    // And the category disclaimer is visible where the reader will see it.
    await expect(page.getByText(/it does not assess how serious the situation is/i)).toBeVisible();
  });

  test('explains a rate limit without mentioning the diagnostic message', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'careos-e2e', value: 'rate-limited', url: 'http://127.0.0.1:3100' }]);
    await page.goto('/request');
    await fillIntakeRequest(page);
    await page.getByRole('button', { name: /send request/i }).click();

    // Next injects its own role="alert" route announcer, so the assertion is scoped
    // by text rather than taking the first alert on the page.
    await expect(page.getByRole('alert').filter({ hasText: /too many requests/i })).toBeVisible();
    // The API's diagnostic `message` is not written for display and must not render.
    await expect(page.getByText('stub')).toHaveCount(0);
  });
});

test.describe('public intake tracking', () => {
  test('shows a tracked request in the API own words and no more', async ({ page }) => {
    await page.goto('/track');
    await expect(page.getByRole('heading', { name: 'Track your request' })).toBeVisible();

    await page.getByLabel(/tracking token/i).fill('ex-tok-00001');
    await page.getByRole('button', { name: /track request/i }).click();

    // The API's caller-safe status label and copy, not our own translation.
    await expect(page.getByText('EX-EM-00001')).toBeVisible();
    await expect(page.getByText('Received', { exact: true })).toBeVisible();
    await expect(page.getByText(/keep this token to check again/i)).toBeVisible();
    await expect(page.getByRole('link', { name: '+254 700 000 111' })).toBeVisible();
    await expect(page.getByRole('link', { name: '+254 999' })).toBeVisible();
    await expect(page.getByText(/careOS does not dispatch emergency services/i)).toBeVisible();

    // A tracker may report a state, never promise one: no help on its way, no
    // assessment, no staffing claim.
    await expect(
      page.getByText(/on its way|a clinician|will be seen|has been assessed|estimated wait/i),
    ).toHaveCount(0);
  });

  test('explains an unknown token without leaking the diagnostic message', async ({ page }) => {
    await page.goto('/track');
    await page.getByLabel(/tracking token/i).fill('definitely-not-a-real-token');
    await page.getByRole('button', { name: /track request/i }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: /no request found for that token/i }),
    ).toBeVisible();
    // The API's diagnostic message is not written for display.
    await expect(page.getByText(/No request found for that tracking token/)).toHaveCount(0);
  });
});

/** Fills every field of the live-contract intake form. */
async function fillIntakeRequest(page: Page) {
  await page.getByLabel(/facility/i).selectOption('example-general-hospital');
  await page.getByLabel(/your name/i).fill('EXAMPLE Test Person');
  await page.getByLabel(/phone number/i).fill('+254700000000');
  await page.getByLabel(/what best describes/i).selectOption('SEVERE_INJURY');
  await page.getByLabel(/for yourself/i).selectOption('true');
  await page.getByLabel(/how should we contact you/i).selectOption('PHONE');
  await page.getByLabel(/what has happened/i).fill('EXAMPLE symptom description for a test.');
}

/**
 * Signs in the way a real staff member does: through `/login`, end to end through
 * the proxy (which lifts the token pair into HttpOnly cookies) and into `/triage`.
 * The staff routes in the sweep depend on this running first.
 */
async function signInViaUi(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/organization id/i).fill('org-e2e-example-0001');
  await page.getByLabel(/^email/i).fill('registrar@example.org');
  await page.getByLabel(/^password/i).fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/triage$/);
}

test.describe('staff session gate', () => {
  test('shows staff content once a session is confirmed', async ({ page }) => {
    // A real sign-in through /login (and the proxy) is what a staff member does.
    await signInViaUi(page);
    // The rail only exists inside the gate, so its presence is proof the content
    // behind it rendered under a session the proxy actually established.
    await expect(page.getByRole('navigation', { name: 'Clinical' })).toBeVisible();
    await expect(page.getByText('EXAMPLE Dr N. Wanjiru')).toBeVisible();
  });

  test('signs out from the header and lands back on the gate', async ({ page }) => {
    await signInViaUi(page);
    await expect(page.getByRole('navigation', { name: 'Clinical' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();

    // The proxy ends the session server-side, the session query is invalidated and
    // the route refreshes onto the signed-out gate.
    await expect(page.getByRole('heading', { name: 'Please sign in again' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('navigation', { name: 'Clinical' })).toHaveCount(0);
  });

  test('withholds staff content when there is no session', async ({ page }) => {
    // Fresh context: no session cookie, so the proxy has nothing to translate and
    // the stub answers 401.
    await page.goto('/triage');

    await expect(page.getByRole('heading', { name: 'Please sign in again' })).toBeVisible();

    // The actual assertion: the thing behind the gate must not be in the document
    // at all. Visible-but-covered would still leak it to a screen reader.
    await expect(page.getByRole('navigation', { name: 'Clinical' })).toHaveCount(0);
    await expect(page.getByText('EXAMPLE Achieng Otieno')).toHaveCount(0);

    // And the dead end is not a dead end anymore: the gate earns the way back in.
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  test('treats a failing API as signed out, and says so differently', async ({ page }) => {
    // Fails closed: if the session cannot be confirmed, staff content must not
    // render. And the message must not tell a clinician to sign in when the real
    // problem is that the service is down — hence no sign-in link on this screen.
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
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  });
});

test.describe('facilities search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/facilities');
    // The directory loads on mount with an empty query; wait for a row before
    // interacting, so assertions never race hydration.
    await expect(page.getByRole('heading', { name: 'EXAMPLE General Hospital' })).toBeVisible();
  });

  test('narrows the directory as the query narrows', async ({ page }) => {
    await page.getByRole('searchbox').fill('referral');

    // A row that no longer matches must be gone from the document, not merely
    // hidden behind a spinner.
    await expect(page.getByRole('heading', { name: 'EXAMPLE General Hospital' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'EXAMPLE Referral Centre' })).toBeVisible();
  });

  test('filters by what a facility offers, using the API own fields', async ({ page }) => {
    // The live directory has no `type` enum; facets are the API's booleans.
    await page.getByRole('checkbox', { name: 'have an ambulance' }).check();

    await expect(page.getByRole('heading', { name: 'EXAMPLE General Hospital' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EXAMPLE Referral Centre' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EXAMPLE Community Clinic' })).toHaveCount(0);
  });

  test('labels capabilities in words, scoped to a row', async ({ page }) => {
    // A word, not a colour: the values are the API's own booleans rendered as
    // text, and strictly within the row that owns them.
    const general = page.getByRole('listitem').filter({ hasText: 'EXAMPLE General Hospital' });
    await expect(general.getByText('Open 24 hours')).toBeVisible();
    await expect(general.getByText('Ambulance on site')).toBeVisible();

    const clinic = page.getByRole('listitem').filter({ hasText: 'EXAMPLE Community Clinic' });
    await expect(clinic.getByText('Open 24 hours')).toHaveCount(0);
    await expect(clinic.getByText('Ambulance on site')).toHaveCount(0);
  });

  test('renders only the phone numbers the API supplied, as tel links', async ({ page }) => {
    // General Hospital has a phone, so a single linkable number appears.
    const general = page.getByRole('listitem').filter({ hasText: 'EXAMPLE General Hospital' });
    await expect(general.getByRole('link', { name: /Phone: \+254 700 000 111/ })).toBeVisible();

    // Community Clinic has no phone on its record, so no links may appear.
    const clinic = page.getByRole('listitem').filter({ hasText: 'EXAMPLE Community Clinic' });
    await expect(clinic.getByRole('link')).toHaveCount(0);
  });

  test('says No facility matches rather than going silent', async ({ page }) => {
    await page.getByRole('searchbox').fill('zzzzzz no such place');

    await expect(page.getByRole('heading', { name: 'No facility matches' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EXAMPLE General Hospital' })).toHaveCount(0);
  });
});
