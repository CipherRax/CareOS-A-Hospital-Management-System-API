'use client';

import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { cn } from '@/lib/cn';
import { LOCALES } from '@/i18n/routing';

/**
 * Locale switch.
 *
 * Real links rather than a `<select>` with an onChange handler. A link has an href
 * a browser can display, middle-click and copy, so the reader can see where they
 * are about to go before they commit — and it works with JavaScript unavailable,
 * which a select onChange does not.
 *
 * They point at `/locale`, which sets the cookie and redirects back, because
 * `localePrefix: 'never'` keeps the language out of the URL and something has to set
 * the cookie. See that route for why the redirect target is validated.
 *
 * Plain `<a>`, deliberately NOT `next/link`.
 *
 * A `next/link` to this endpoint navigates client-side over the RSC protocol, and
 * that request arrives as `GET /locale?_rsc=Z2CKei4XOvD7hupt` — with the query
 * string dropped. The handler saw no locale and no target, fell back to English and
 * to `/`, and the switch silently did nothing while setting a cookie the whole time.
 * curl and the unit tests both passed, because neither of them does an RSC
 * navigation; only the browser test caught it.
 *
 * Setting a cookie is a state change. It belongs in a full document navigation,
 * which is also the only thing that reliably reaches a route handler.
 *
 * `useLocale` reports the locale the messages were actually loaded with, so the
 * indicator cannot claim a language the page is not in.
 *
 * Only on the public surface. Staff screens are on managed workstations where the
 * language follows the machine, and an accidental switch mid-consultation is a cost
 * with no upside. ADR-002.
 */

const LOCALE_LABEL: Record<(typeof LOCALES)[number], string> = {
  en: 'English',
  sw: 'Kiswahili',
};

export function LocaleSwitcher({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useTranslations('common');
  const active = useLocale();

  return (
    <nav aria-label={t('language')} className={cn('flex items-center gap-1', className)}>
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <a
            key={locale}
            href={`/locale?${new URLSearchParams({ set: locale, next: pathname })}`}
            // Marks the current language for assistive technology. Without it a
            // screen reader announces two identical-looking links and gives no
            // indication which one is in effect.
            aria-current={isActive ? 'true' : undefined}
            hrefLang={locale}
            lang={locale}
            className={cn(
              'rounded-md px-3 py-2 text-public-small underline-offset-2',
              isActive
                ? 'font-semibold text-primary underline'
                : 'text-secondary hover:bg-surface-hover hover:text-primary hover:underline',
            )}
          >
            {LOCALE_LABEL[locale]}
          </a>
        );
      })}
    </nav>
  );
}
