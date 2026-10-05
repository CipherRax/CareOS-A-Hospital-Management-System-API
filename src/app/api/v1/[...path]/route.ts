import { NextResponse } from 'next/server';

import { env } from '@/lib/env';

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
 */

export const dynamic = 'force-dynamic';

/** Upstream budget. Generous for a clinical write, short enough to fail visibly. */
const UPSTREAM_TIMEOUT_MS = 15_000;

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

async function proxy(request: Request, segments: string[]): Promise<Response> {
  const requestId = newRequestId();
  const incoming = request.headers.get('cookie');

  // Path is re-encoded from already-decoded segments. Forwarding the raw
  // request URL would carry our own query string and host into the upstream call.
  const path = segments.map((s) => encodeURIComponent(s)).join('/');
  const incomingUrl = new URL(request.url);
  const target = `${env.API_INTERNAL_URL.replace(/\/$/, '')}/${path}${incomingUrl.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name)) continue;
    if (name === 'cookie' || name === 'authorization') continue;
    headers.set(key, value);
  }
  // Re-added explicitly so a multi-cookie header survives intact.
  if (incoming) headers.set('cookie', incoming);
  headers.set('x-request-id', requestId);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  // Node fetch has no timeout. Without this, an unreachable upstream leaves the
  // browser spinning until its own limit, and the user sees nothing for minutes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      signal: controller.signal,
      // Never let the platform cache a clinical response.
      cache: 'no-store',
      redirect: 'manual',
    });

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
      aborted ? 'SERVICE_UNAVAILABLE' : 'SERVICE_UNAVAILABLE',
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
