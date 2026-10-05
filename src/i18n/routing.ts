import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing.
 *
 * `localePrefix: 'never'` is deliberate and matches the brief's route structure,
 * which lists `app/(public)/`, `app/(auth)/`, `app/(staff)/` with no `[locale]`
 * segment. URLs stay stable and shareable, and the locale lives in a cookie.
 *
 * The trade: a Swahili visitor's URL does not advertise the language, so a link
 * pasted into a chat opens in the recipient's own locale rather than the
 * sender's. That is the right default here — patients in the same catchment
 * share languages far more often than staff, and clinical URLs are spoken aloud
 * and typed by hand, where a locale prefix is a liability.
 *
 * If that trade is wrong for a specific surface, the fix is a locale segment on
 * that surface only. See docs/decisions.md ADR-002.
 */
export const routing = defineRouting({
  locales: ['en', 'sw'],
  defaultLocale: 'en',
  localePrefix: 'never',
  // The app owns locale detection through its own cookie so it sits alongside the
  // theme and density cookies rather than competing with them.
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];

export const LOCALES = routing.locales;
export const DEFAULT_LOCALE = routing.defaultLocale;
