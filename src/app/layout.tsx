import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource-variable/source-serif-4';

import { Toaster, TooltipProvider } from '@/components/ui';
import { MockProvider } from '@/mocks/mock-provider';
import { ThemeProvider } from '@/design/theme/provider';
import { QueryProvider } from '@/lib/data/query-provider';
import { THEME_BOOTSTRAP_SCRIPT } from '@/design/theme/preferences';
import { getThemePreference } from '@/design/theme/server';
import { publicEnv } from '@/lib/env';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: publicEnv.appName,
    template: `%s | ${publicEnv.appName}`,
  },
  description: 'Hospital management platform.',
  // careOS handles identifiable patient information. Referrers can leak which
  // facility a clinician is looking at, so none are sent.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Both themes are first-class; the theme comes from a cookie, so the browser
  // UI should not override it.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F5F3' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1513' },
  ],
  width: 'device-width',
  initialScale: 1,
  // 18px base type on the public layer depends on the user's own browser setting
  // being respected; forcing a maximum would override an accessibility choice.
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Cookies make this layout dynamic. That is the trade for a correct first
  // paint with no flash of the wrong theme; see src/design/theme/preferences.ts.
  const { theme, density } = await getThemePreference();

  // The nonce set by the proxy for this request, so the theme bootstrap script
  // below satisfies `script-src 'nonce-...'`. Same-source invariant with the
  // header; see src/proxy.ts and docs/decisions.md ADR-010.
  const nonce = (await headers()).get('x-nonce') ?? '';

  const messages = await getMessages();
  // Must match the resolved locale, not a constant. Screen readers pick a voice
  // from `lang`, so a Swahili page announced with an English voice is not a cosmetic
  // bug — it makes the whole page harder to follow for the people it exists for.
  // This was hardcoded to "en" until the public locale switch made a second locale
  // reachable.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      // `system` cannot be resolved on the server, so light is the deterministic
      // baseline and the inline script below corrects it before paint.
      data-theme={theme === 'system' ? 'light' : theme}
      data-theme-pref={theme}
      data-density={density}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before first paint to resolve `system` and to pick up a
            preference changed in another tab. Inlined because it must not wait
            for the bundle. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
          suppressHydrationWarning
        />
      </head>
      <body>
        <ThemeProvider initialPreference={theme} initialDensity={density}>
          {/* `locale` passed explicitly: without it the client hooks have no locale
              to report and `useLocale()` falls back to the default, which would
              disagree with the server-rendered markup. */}
          <NextIntlClientProvider locale={locale} messages={messages}>
            {/* Inside the locale and theme providers so a data-driven screen has
                the same context a static one does. */}
            <QueryProvider>
              <TooltipProvider>
                {/* Build-time constant: never mounted, and never bundled, in production. */}
                {publicEnv.enableMocks ? <MockProvider>{children}</MockProvider> : children}
                <Toaster />
              </TooltipProvider>
            </QueryProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
