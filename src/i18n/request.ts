import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from './routing';

export const LOCALE_COOKIE = 'careos-locale';

/**
 * Message loading.
 *
 * Messages are imported statically rather than read from the filesystem at
 * runtime, so they are code-split with the build output and a missing translation
 * is a build-time failure instead of a silent English fallback in production.
 *
 * There is deliberately no next-intl middleware/proxy. With `localePrefix` set to
 * 'never' it still rewrote every request to `/<locale>/<path>`, which does not
 * exist in a route tree without a `[locale]` segment — producing a permanent
 * redirect loop on every page. Since automatic locale detection is unwanted
 * anyway (`localeDetection: false`, and the app owns the preference alongside its
 * theme and density cookies), the proxy earned nothing and cost correctness.
 * Resolving the locale here keeps the brief's unprefixed route structure.
 *
 * Strings are extracted from day one: every user-visible string resolves through
 * this catalogue, so the patient portal can be translated first without a later
 * refactor. See docs/decisions.md ADR-003.
 */
const catalogues = {
  en: () => import('./messages/en.json'),
  sw: () => import('./messages/sw.json'),
} as const;

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  const locale = (LOCALES as readonly string[]).includes(raw ?? '')
    ? (raw as (typeof LOCALES)[number])
    : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await catalogues[locale]()).default,
    // Number and date formatting follows the locale; a product serving en and sw
    // must not render "1,204" for a Swahili reader.
    formats: {},
  };
});
