import { describe, expect, it } from 'vitest';

import { GET, safeTarget } from './route';

/**
 * The locale switch is a redirect endpoint on a clinical application, so the
 * redirect target is the security-relevant part of it. `?next=` is attacker-supplied
 * on a page a patient is sent to by someone they trust, and an unchecked value here
 * turns a careOS link into a convincing phishing redirect that originates from our
 * own domain.
 */

const ORIGIN = 'http://127.0.0.1:3100';

function switchTo(query: string) {
  return GET(new Request(`${ORIGIN}/locale?${query}`));
}

describe('locale switch', () => {
  it('sets the locale cookie', () => {
    const response = switchTo('set=sw');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('careos-locale=sw');
  });

  it('sets the cookie httpOnly, since no client script needs to read it', () => {
    expect(switchTo('set=sw').headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('scopes the cookie to the whole site', () => {
    // Path=/ matters: the cookie has to survive navigation between the public
    // portal and the staff shell, or the language silently reverts.
    expect(switchTo('set=sw').headers.get('set-cookie')).toContain('Path=/');
  });

  it('redirects back to where the reader was', () => {
    expect(switchTo('set=sw&next=%2Frequest').headers.get('location')).toBe('/request');
  });

  it('redirects relatively, so it cannot land on a different host', () => {
    // Next normalises `request.url` to the bound hostname, so building an absolute
    // Location from it produced `localhost` for a request made against `127.0.0.1`.
    // The browser followed it to another host and the cookie never travelled with
    // it, so the switch silently did nothing. A relative Location cannot go wrong.
    const location = switchTo('set=sw&next=%2Frequest').headers.get('location') ?? '';
    expect(location.startsWith('/')).toBe(true);
    expect(location).not.toContain('localhost');
  });

  it('uses 303 so the change is not re-requested as a GET', () => {
    expect(switchTo('set=sw').status).toBe(303);
  });

  it('does not set Secure over plain HTTP', () => {
    // Keyed off NODE_ENV, a production build served over HTTP produced a Secure
    // cookie that the browser discards, so the switch appeared to do nothing.
    const response = switchTo('set=sw');
    expect(response.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('sets Secure when the request arrived over TLS', () => {
    const proxied = GET(
      new Request(`${ORIGIN}/locale?set=sw`, { headers: { 'x-forwarded-proto': 'https' } }),
    );
    expect(proxied.headers.get('set-cookie')).toContain('Secure');
  });

  it('falls back to English for a locale it does not have', () => {
    // A bad locale must not leave someone with no catalogue at all.
    expect(switchTo('set=zz').headers.get('set-cookie')).toContain('careos-locale=en');
  });

  it('falls back to English when no locale is given at all', () => {
    expect(switchTo('').headers.get('set-cookie')).toContain('careos-locale=en');
  });
});

describe('safeTarget', () => {
  it('accepts a same-origin relative path', () => {
    expect(safeTarget('/request')).toBe('/request');
    expect(safeTarget('/triage/EX-0001?tab=history')).toBe('/triage/EX-0001?tab=history');
  });

  it('refuses an absolute URL', () => {
    // The phishing case: a careOS link that lands somewhere else entirely.
    expect(safeTarget('https://evil.example/steal')).toBe('/');
  });

  it('refuses a protocol-relative URL', () => {
    // `//evil.example` is navigated off-origin despite starting with a slash.
    expect(safeTarget('//evil.example')).toBe('/');
  });

  it('refuses a backslash form', () => {
    // Browsers normalise `/\` to `//`, so this is the same attack with a different
    // first character.
    expect(safeTarget('/\\evil.example')).toBe('/');
  });

  it('refuses a relative path that is not rooted', () => {
    expect(safeTarget('evil.example')).toBe('/');
  });

  it('refuses nothing gracefully', () => {
    expect(safeTarget(null)).toBe('/');
    expect(safeTarget('')).toBe('/');
  });
});

describe('redirect target is validated end to end', () => {
  it('does not redirect off-origin even when asked to', () => {
    const location = switchTo(
      'set=sw&next=' + encodeURIComponent('https://evil.example/collect'),
    ).headers.get('location');
    expect(location).toBe('/');
  });
});
