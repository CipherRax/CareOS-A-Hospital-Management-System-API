import { expect, test, type Page } from '@playwright/test';

/**
 * Response-header security guarantees.
 *
 * The Content Security Policy is asserted from the proxy with a per-request
 * nonce (see src/proxy.ts, ADR-010). These tests pin the two facts that a
 * unit test cannot: the browser-received header matches the requirement, and
 * the nonce written into the markup is the one the header enforces. If they
 * ever disagree, the theme bootstrap script is being blocked by its own policy.
 */

const PUBLIC_PAGE = '/login';

/**
 * Whether a <script> element would actually run under CSP enforcement: external
 * scripts are allowed by `'self'`, and JSON/other non-JS data blocks are inert
 * and not subject to script-src. Only inline, executable scripts need the nonce.
 *
 * The nonce is read through the `nonce` IDL property, not the attribute:
 * browsers hide the nonce content attribute from the DOM (attribute selectors,
 * `getAttribute`) to stop reflection attacks, while `element.nonce` still
 * exposes the value the CSP header is enforcing.
 */
async function executableInlineScripts(page: Page) {
  const scripts = page.locator('script');
  const count = await scripts.count();
  const executable: string[] = [];
  for (let i = 0; i < count; i++) {
    const src = await scripts.nth(i).getAttribute('src');
    if (src) continue;
    const type = await scripts.nth(i).getAttribute('type');
    if (type && type !== 'module' && !type.includes('javascript')) continue;
    const text = await scripts.nth(i).innerText();
    if (!text.trim()) continue;
    executable.push((await scripts.nth(i).evaluate((el) => (el as HTMLScriptElement).nonce)) ?? '');
  }
  return executable;
}

test('serves a strict, nonce-based Content Security Policy', async ({ request }) => {
  const res = await request.get(PUBLIC_PAGE);
  const csp = res.headers()['content-security-policy'] ?? '';

  expect(csp).toMatch(/default-src 'self'/);
  expect(csp).toMatch(/script-src 'self' 'nonce-/);
  // `style-src-attr 'unsafe-inline'` legitimately contains the word "style-src";
  // these negatives target the directive itself, not its attribute variant.
  expect(csp).not.toMatch(/script-src[^-][^;]*'unsafe-inline'/);
  expect(csp).toMatch(/style-src 'self' 'nonce-/);
  expect(csp).not.toMatch(/style-src[^-][^;]*'unsafe-inline'/);
  // Style *attributes* stay allowed for the design-system token swatches; the
  // unrestricted inline style allowance is gone.
  expect(csp).toContain("style-src-attr 'unsafe-inline'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("form-action 'self'");
});

test('applies the header nonce to every executable inline script', async ({ page }) => {
  const response = await page.goto(PUBLIC_PAGE);
  const csp = response?.headers()['content-security-policy'] ?? '';
  const headerNonce = csp.match(/script-src 'self' 'nonce-([^']+)/)?.[1];

  const nonces = await executableInlineScripts(page);
  expect(nonces.length).toBeGreaterThan(0);

  for (const nonce of nonces) {
    expect(nonce, 'inline executable script must carry the CSP nonce').toBeTruthy();
    expect(nonce, 'nonce on markup must be the nonce in the header').toBe(headerNonce);
  }
});
