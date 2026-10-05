import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * A single Chromium project, deliberately. Cross-browser testing belongs here but
 * is not yet justified: clinical deployments are managed institutional
 * workstations on a known browser, and a cross-browser matrix on a phase that has
 * not yet rendered anything in a browser would be theatre. Revisit when real
 * deployment data says which browsers matter.
 *
 * The web server is started by Playwright so a run needs no manual setup, and
 * mocks are disabled so the accessibility run exercises the real markup rather
 * than a mocked-data variant of it.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // The API the proxy forwards to. Real HTTP, one endpoint, so the proxy and
      // the staff session gate are exercised rather than bypassed.
      command: 'node e2e/stub-api.mjs',
      url: 'http://127.0.0.1:3199/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { STUB_API_PORT: '3199' },
    },
    {
      // `output: standalone` means `next start` is not the right entry point — the
      // build emits a self-contained server instead.
      command: 'node .next/standalone/server.js',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: '3100',
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
        // A production build must never serve mocks, and the env guard in
        // src/lib/env.ts enforces it. Asserted here so the a11y run cannot
        // accidentally validate mocked markup.
        NEXT_PUBLIC_ENABLE_MOCKS: 'false',
        API_INTERNAL_URL: 'http://127.0.0.1:3199',
      },
    },
  ],
});
