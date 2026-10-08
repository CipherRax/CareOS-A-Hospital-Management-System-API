import { NextResponse, type NextRequest } from 'next/server';

/**
 * The request header that carries the per-request CSP nonce. The name is not
 * ours to choose: when Next.js finds a request header named exactly `x-nonce`,
 * it applies the value as a `nonce` attribute to the inline scripts and styles
 * it emits itself (the RSC payload, hydration bootstrap, ...). The root layout
 * reads the same header so the theme bootstrap script carries the matching
 * nonce. See docs/decisions.md ADR-010.
 */
export const CSP_NONCE_HEADER = 'x-nonce';

/**
 * CareOS is served with a Content Security Policy that has no `unsafe-inline`
 * for scripts, enforced with a unique nonce per request.
 *
 * The header deliberately does NOT live in next.config.ts. A nonce must be
 * fresh for every response, static headers can only hold constants, and the
 * same nonce has to reach both the browser (in the header) and the markup (as
 * the `nonce` attribute on the theme bootstrap script). The proxy is the only
 * place in the request path that can produce that pairing, by forwarding the
 * nonce to the page via `x-nonce`.
 *
 * `style-src-attr 'unsafe-inline'` is a deliberate residual allowance: the
 * design-system screen paints color-token swatches with inline `style`
 * attributes, and style attributes are the low-risk injection surface compared
 * to a `<style>` element. Inline `<style>` blocks are not allowed.
 * See docs/decisions.md ADR-010.
 */

/** Build the nonce value. Hexish noise in a CSP header is insensitive. */
function generateNonce(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export function cspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = generateNonce();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', cspHeader(nonce));
  return response;
}

export const config = {
  // Keep the middleware off static assets; a CSP header is meaningless on a
  // font or a hashed chunk, and skipping them keeps every request cheap.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
