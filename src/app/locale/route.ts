import { NextResponse } from 'next/server';

import { LOCALE_COOKIE } from '@/i18n/request';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/routing';

/**
 * Locale switch endpoint.
 *
 * `localePrefix: 'never'` means the locale lives in a cookie rather than the URL,
 * which needs somewhere to set it. A link cannot set a cookie, so the switcher
 * points here and this redirects back.
 *
 * It exists because the Swahili catalogue has been complete since F0 with no way
 * for anyone to reach it — the public emergency form was available in one language
 * only, in a country where that is not an acceptable default for a surface that
 * people reach in a hurry.
 *
 * Two things this deliberately does not do:
 *
 *  - It does not accept a bare locale with no redirect target. A switch that leaves
 *    you on `/locale` is worse than no switch.
 *  - It does not trust `next`. It is a redirect endpoint, so an unchecked parameter
 *    is an open redirect: `?next=https://evil.example` would send a patient handed
 *    a link by someone they trusted to somewhere that looks like careOS. Only
 *    same-origin relative paths are honoured, and anything else falls back to the
 *    home page.
 */

export const dynamic = 'force-dynamic';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function GET(request: Request) {
  const url = new URL(request.url);

  const requested = url.searchParams.get('set');
  const locale = (LOCALES as readonly string[]).includes(requested ?? '')
    ? (requested as (typeof LOCALES)[number])
    : DEFAULT_LOCALE;

  const target = safeTarget(url.searchParams.get('next'));

  /**
   * A relative `Location`, deliberately.
   *
   * `NextResponse.redirect(new URL(target, url.origin))` produced
   * `http://localhost:3100/request` for a request made against `127.0.0.1:3100` —
   * Next normalises the origin in `request.url` to the bound hostname. The browser
   * then followed the redirect to a *different host*, the cookie was set for the
   * original host, and the reader silently landed back on the language they had just
   * left. The switch looked broken with nothing in the network log to explain it.
   *
   * A relative Location has no host in it, so there is nothing to get wrong and
   * nothing to trust.
   */
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: target },
  });
  // 303 rather than 302: a redirect that follows a state change should not be
  // re-requestable as a GET by some intermediaries.

  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    // Server-set and never read by the client, so it is not script-accessible.
    httpOnly: true,
    // Derived from the request, not from NODE_ENV. Keying it off NODE_ENV set
    // `Secure` in local production builds served over plain HTTP, where browsers
    // drop the cookie outright — the switch appeared to do nothing. A careOS
    // deployment must terminate TLS; this follows the request rather than
    // pretending to know better than it.
    secure: isHttps(request, url),
  });
  return response;
}

/** Whether this request arrived over TLS, directly or via a terminating proxy. */
function isHttps(request: Request, url: URL): boolean {
  if (url.protocol === 'https:') return true;
  const forwarded = request.headers.get('x-forwarded-proto');
  return forwarded?.split(',')[0]?.trim() === 'https';
}

/**
 * Narrows a redirect target to a same-origin relative path.
 *
 * Rejects absolute URLs, protocol-relative `//host` targets, and backslash forms,
 * all three of which browsers will happily treat as off-site destinations. Anything
 * unrecognised becomes the home page rather than being echoed back.
 */
export function safeTarget(next: string | null): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  // `//evil.example` and `/\evil.example` are both navigable to another origin.
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
