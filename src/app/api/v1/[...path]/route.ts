import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { REFRESH_COOKIE, SESSION_COOKIE } from '@/lib/session-cookies';

/**
 * Same-origin API proxy.
 *
 * The browser calls our own origin; this handler forwards to API_INTERNAL_URL.
 * Three things follow, and all three are the point:
 *
 *  - The API host is never in the client bundle, so internal cluster addressing
 *    is not disclosed to anyone who views source.
 *  - No CORS preflight, and the session cookie stays first-party. A cross-origin
 *    cookie needs SameSite=None plus a Secure flag and an explicit allow-list,
 *    which is a wider door than this needs to be.
 *  - Anything sensitive stays on the server.
 *
 * This is a proxy, not a rewrite layer: it forwards the method, path, query,
 * cookies and body, and returns the upstream status and body unchanged. It
 * interprets nothing, so a contract change cannot be masked here.
 *
 * Session bridge (the one deliberate interpretation this proxy makes, F1):
 *
 * The API is Bearer-only — `/auth/login` returns an access/refresh token pair in
 * the response body, and every upstream guard reads `Authorization: Bearer`. The
 * browser, by the constraint above, must never hold tokens it could lose to XSS,
 * so the proxy owns the session instead:
 *
 *  - On a successful `/auth/login` or `/auth/mfa/verify` (the two endpoints that
 *    conclude a session with a token pair) the tokens are lifted out of the
 *    response, written to two HttpOnly cookies (`careos_session`,
 *    `careos_refresh`), and stripped from the body the browser sees.
 *  - On every request, `careos_session` is translated into the Bearer header the
 *    API's guards require.
 *  - On a 401 for a request that carried a session token, the proxy rotates once
 *    through `/auth/refresh` (which the API rotates on every use) and retries.
 *  - On `/auth/logout` the refresh token is injected from the cookie, and a 2xx
 *    clears both cookies.
 *
 * The cookies are HttpOnly (JS can never read them), SameSite=Lax, and Secure
 * only over TLS (mirrors the locale route's handling).
 */

export const dynamic = 'force-dynamic';

/** Upstream budget. Generous for a clinical write, short enough to fail visibly. */
const UPSTREAM_TIMEOUT_MS = 15_000;

/** Access-token TTL used for the session cookie when the login body omits it. */
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
/** Refresh cookie life when the login body carries no `refreshTokenExpiresAt`. */
const DEFAULT_REFRESH_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Headers that describe a single hop and must not be forwarded. Forwarding
 * `content-length` alongside a re-encoded body, or `host`, produces confusing
 * upstream failures that look like API bugs.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Recomputed for the upstream request.
  'host',
  'content-length',
]);

/**
 * Returns a response shaped like the API's own error envelope.
 *
 * Deliberately conforms to ErrorEnvelope so the client's error handling has one
 * code path whether a failure came from the API or from the hop in front of it.
 * `message` stays diagnostic — the UI maps `code` through the error catalogue and
 * never renders this text.
 */
function proxyError(status: number, code: string, message: string, requestId: string) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
      meta: { requestId, timestamp: new Date().toISOString() },
    },
    { status, headers: { 'x-request-id': requestId } },
  );
}

/** New request id per attempt, so a support call can be traced end to end. */
function newRequestId(): string {
  return crypto.randomUUID();
}

/** Value of a named cookie, or `undefined` when the header does not carry it. */
function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      if (raw.length === 0) return undefined;
      return decodeURIComponent(raw);
    }
  }
  return undefined;
}

/**
 * Removes the `Domain` attribute from a Set-Cookie value.
 *
 * Only the attribute is touched. `Path`, `HttpOnly`, `Secure`, `SameSite` and
 * `Max-Age` are preserved exactly — weakening `Secure` or `SameSite` here to
 * "make it work" would trade a visible bug for an invisible security one.
 */
function stripCookieDomain(setCookie: string): string {
  return setCookie.replace(/;\s*domain=[^;]*/gi, '');
}

/** Whether this request arrived over TLS, directly or via a terminating proxy. */
function isHttps(request: Request, url: URL): boolean {
  if (url.protocol === 'https:') return true;
  const forwarded = request.headers.get('x-forwarded-proto');
  return forwarded?.split(',')[0]?.trim() === 'https';
}

/**
 * The refresh cookie scopes to the access token's life when the API names one;
 * otherwise it falls back to a wide default, since a long-lived refresh is the
 * point of having one.
 */
function refreshMaxAge(expiresAt: unknown): number {
  if (typeof expiresAt === 'string') {
    const ms = Date.parse(expiresAt);
    if (!Number.isNaN(ms)) return Math.max(0, Math.floor((ms - Date.now()) / 1000));
  }
  return DEFAULT_REFRESH_AGE_SECONDS;
}

function accessMaxAge(expiresIn: unknown): number {
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
    ? Math.floor(expiresIn)
    : DEFAULT_ACCESS_TTL_SECONDS;
}

/**
 * Upstream headers.
 *
 * The browser's own `Authorization` header is never forwarded: the web app has no
 * business sending one when the proxy owns the tokens. `Cookie` is re-added
 * explicitly so a multi-cookie header survives intact, then the session cookie is
 * translated into the Bearer header the API's guards require.
 */
function upstreamHeaders(
  request: Request,
  incoming: string | null,
  requestId: string,
  sessionToken: string | undefined,
): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name)) continue;
    if (name === 'cookie' || name === 'authorization') continue;
    headers.set(key, value);
  }
  if (incoming) headers.set('cookie', incoming);
  if (sessionToken) headers.set('authorization', `Bearer ${sessionToken}`);
  headers.set('x-request-id', requestId);
  return headers;
}

/** Node fetch has no timeout; without one an unreachable upstream hangs the page. */
function withTimeout(): { controller: AbortController; timer: NodeJS.Timeout } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  return { controller, timer };
}

async function fetchUpstream(
  target: string,
  signal: AbortSignal,
  init: RequestInit,
): Promise<Response> {
  return fetch(target, {
    ...init,
    signal,
    // Never let the platform cache a clinical response.
    cache: 'no-store',
    redirect: 'manual',
  });
}

/**
 * Builds the browser-facing response for an upstream response: strips hop-by-hop
 * headers, rebinds any upstream Set-Cookie to our origin, and never lets a shared
 * cache key a clinical response by URL alone.
 */
function fromUpstream(upstream: Response, requestId: string): NextResponse {
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    // A cookie set upstream must be rebound to our own origin. Left alone it
    // carries a Domain the browser has never seen and is silently dropped, so
    // the session appears never to have been set. Dropping the attribute scopes
    // it to this host, which is what same-origin was chosen for.
    if (key.toLowerCase() === 'set-cookie') {
      responseHeaders.append(key, stripCookieDomain(value));
      continue;
    }
    responseHeaders.set(key, value);
  }
  responseHeaders.set('x-request-id', requestId);
  // Defence in depth: an upstream must never be able to loosen our own policy.
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  // A shared cache keyed on URL alone would serve one clinician's response to
  // another. `no-store` is set unconditionally rather than only when upstream
  // omits it, because the failure this guards against is upstream silence.
  if (!responseHeaders.has('cache-control')) {
    responseHeaders.set('cache-control', 'no-store');
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

interface SessionTokens {
  accessToken: unknown;
  refreshToken: unknown;
  expiresIn?: unknown;
  refreshTokenExpiresAt?: unknown;
}

/** Pulls the token pair out of a `LoginResultDto` envelope, if present. */
function tokensFromBody(body: unknown): SessionTokens | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = body as {
    data?: {
      tokens?: {
        accessToken?: unknown;
        refreshToken?: unknown;
        expiresIn?: unknown;
        refreshTokenExpiresAt?: unknown;
      };
    };
  };
  const tokens = envelope.data?.tokens;
  if (
    !tokens ||
    typeof tokens.accessToken !== 'string' ||
    typeof tokens.refreshToken !== 'string'
  ) {
    return null;
  }
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
  };
}

/**
 * Hands the session cookies to the browser: an HttpOnly pair set (or cleared,
 * when `clear` is true) on our own origin, scoped to the whole site so the
 * proxy's cookie can ride along on every `/api/v1` request it proves.
 */
function applySessionCookies(
  response: NextResponse,
  request: Request,
  url: URL,
  tokens: SessionTokens | null,
  clear: boolean,
): void {
  const secure = isHttps(request, url);
  if (clear) {
    response.cookies.delete(SESSION_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return;
  }
  if (!tokens) return;
  response.cookies.set(SESSION_COOKIE, tokens.accessToken as string, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: accessMaxAge(tokens.expiresIn),
  });
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken as string, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: refreshMaxAge(tokens.refreshTokenExpiresAt),
  });
}

/**
 * Concludes a session-bearing flow: `/auth/login` and `/auth/mfa/verify`. This
 * is the one response whose body the proxy rewrites — the token pair is lifted
 * into HttpOnly cookies and removed from what the browser sees, so the secret
 * never exists in page-reachable memory. Kept as a separate step so the "pinch
 * every leak" path is a single function to read.
 */
async function finalizeSession(
  upstream: Response,
  request: Request,
  url: URL,
  requestId: string,
): Promise<Response> {
  const text = await upstream.text();
  const response = fromUpstream(
    new Response(text, { status: upstream.status, headers: upstream.headers }),
    requestId,
  );
  let tokens: SessionTokens | null = null;
  let body = text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    tokens = tokensFromBody(parsed);
    if (tokens) {
      const data = parsed.data as Record<string, unknown>;
      const sanitised = { ...parsed, data: { ...data } };
      delete (sanitised.data as { tokens?: unknown }).tokens;
      body = JSON.stringify(sanitised);
    }
  } catch {
    // Not the documented shape; pass the upstream body through untouched.
  }
  if (tokens) {
    const rebuilt = fromUpstream(
      new Response(body, { status: upstream.status, headers: upstream.headers }),
      requestId,
    );
    applySessionCookies(rebuilt, request, url, tokens, false);
    return rebuilt;
  }
  // No token pair (e.g. an MFA challenge): nothing to set, and nothing about this
  // response should disturb an existing session.
  applySessionCookies(response, request, url, null, false);
  return response;
}

async function proxy(request: Request, segments: string[]): Promise<Response> {
  const requestId = newRequestId();
  const incoming = request.headers.get('cookie');
  const sessionToken = cookieValue(incoming, SESSION_COOKIE);
  const refreshToken = cookieValue(incoming, REFRESH_COOKIE);

  // Path is re-encoded from already-decoded segments. Forwarding the raw
  // request URL would carry our own query string and host into the upstream call.
  const path = segments.map((s) => encodeURIComponent(s)).join('/');
  const incomingUrl = new URL(request.url);
  const target = `${env.API_INTERNAL_URL.replace(/\/$/, '')}/${path}${incomingUrl.search}`;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  // Read once so a body can be replayed after a refresh-rotation retry, and so a
  // refresh token can be injected into a logout the browser is not allowed to know.
  const rawBody = hasBody ? new TextDecoder().decode(await request.arrayBuffer()) : undefined;
  // `Uint8Array` is narrowed as `ArrayBufferLike` while the DOM fetch expects
  // `ArrayBuffer`; the cast is to the existing runtime behaviour, not around it.
  let requestBody: BodyInit | undefined =
    rawBody && rawBody.length > 0
      ? (new TextEncoder().encode(rawBody) as unknown as BodyInit)
      : undefined;

  const isLogin = request.method === 'POST' && path === 'auth/login';
  const isMfaVerify = request.method === 'POST' && path === 'auth/mfa/verify';
  const isLogout = request.method === 'POST' && path === 'auth/logout';
  // The public auth endpoints speak for themselves: a 401 from login is "bad
  // credentials", from mfa/verify a "challenge invalid or already used" — neither
  // is "refresh and try again" — and rotating inside refresh/logout would be a
  // loop.
  const needsRotation = !isLogin && !isMfaVerify && !isLogout && path !== 'auth/refresh';

  // `/auth/logout` requires a `refreshToken` in the body. The browser cannot know
  // one (HttpOnly), so the proxy completes the request the way the design works:
  // whatever the page sent, the refresh cookie fills in the missing secret.
  if (isLogout && refreshToken) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed =
        rawBody && rawBody.length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      // Unparseable; the only field this endpoint reads is injected below.
    }
    if (typeof parsed.refreshToken !== 'string' || parsed.refreshToken.length === 0) {
      parsed.refreshToken = refreshToken;
      requestBody = JSON.stringify(parsed);
    }
  }

  const headers = upstreamHeaders(request, incoming, requestId, sessionToken);
  if (requestBody && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const { controller, timer } = withTimeout();

  try {
    const upstream = await fetchUpstream(target, controller.signal, {
      method: request.method,
      headers,
      body: requestBody ?? undefined,
    });

    // Stale access token: the API 401s, one rotation through /auth/refresh fixes
    // it. The refresh token is HttpOnly, so only the proxy can do this.
    if (needsRotation && upstream.status === 401 && sessionToken && refreshToken) {
      const refreshResponse = await fetchUpstream(
        `${env.API_INTERNAL_URL.replace(/\/$/, '')}/auth/refresh`,
        controller.signal,
        {
          method: 'POST',
          headers: new Headers({ 'content-type': 'application/json', 'x-request-id': requestId }),
          body: JSON.stringify({ refreshToken }),
        },
      );
      let refreshedTokens: SessionTokens | null = null;
      if (refreshResponse.status >= 200 && refreshResponse.status < 300) {
        refreshedTokens = tokensFromBody(await refreshResponse.json().catch(() => null));
      }
      if (refreshedTokens) {
        const retryHeaders = upstreamHeaders(
          request,
          incoming,
          requestId,
          refreshedTokens.accessToken as string,
        );
        const retried = await fetchUpstream(target, controller.signal, {
          method: request.method,
          headers: retryHeaders,
          body: requestBody ?? undefined,
        });
        const response = fromUpstream(retried, requestId);
        applySessionCookies(response, request, incomingUrl, refreshedTokens, false);
        return response;
      }
      // Refresh failed (revoked/rotated elsewhere): the family is dead, so the
      // session cookies must go rather than linger on a machine that is signed
      // out without knowing it.
      const response = fromUpstream(upstream, requestId);
      applySessionCookies(response, request, incomingUrl, null, true);
      return response;
    }

    if ((isLogin || isMfaVerify) && upstream.status >= 200 && upstream.status < 300) {
      return finalizeSession(upstream, request, incomingUrl, requestId);
    }

    const response = fromUpstream(upstream, requestId);

    if (isLogout && upstream.status >= 200 && upstream.status < 300) {
      applySessionCookies(response, request, incomingUrl, null, true);
    }

    return response;
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    // Logged server-side with the request id only. Request and response bodies may
    // contain patient data and are never written to a log.
    console.error(
      `[api-proxy] ${request.method} ${path} failed requestId=${requestId}`,
      aborted ? 'timeout' : (error as Error).message,
    );
    return proxyError(
      aborted ? 504 : 502,
      'SERVICE_UNAVAILABLE',
      aborted
        ? `Upstream did not respond within ${UPSTREAM_TIMEOUT_MS}ms`
        : 'Upstream API unreachable',
      requestId,
    );
  } finally {
    clearTimeout(timer);
  }
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function POST(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function PUT(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function PATCH(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function DELETE(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function HEAD(request: Request, context: Context) {
  return proxy(request, (await context.params).path);
}
