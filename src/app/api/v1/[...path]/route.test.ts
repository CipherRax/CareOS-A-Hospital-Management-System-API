import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { server as msw } from '@/mocks/server';

/**
 * Proxy behaviour, exercised against a real HTTP server rather than a mocked
 * `fetch`.
 *
 * A stubbed fetch would let a body that never arrives, a header that is dropped,
 * or a timeout that never fires pass as correct. The failure modes that matter
 * here — a swallowed session cookie, an unbounded hang, a leaked upstream host —
 * are all invisible until real bytes move.
 */

const upstream = vi.fn();
let server: Awaited<ReturnType<typeof startServer>>;

/**
 * The route handlers are imported dynamically, not statically.
 *
 * `src/lib/env.ts` parses `process.env` once at module load, so a static import
 * would freeze `API_INTERNAL_URL` to its default before `beforeAll` learns the
 * port the test server happened to bind. Every request would then 502 against a
 * dead port and the suite would pass for entirely the wrong reason.
 */
type Handlers = typeof import('@/app/api/v1/[...path]/route');
let handlers: Handlers;

/** Records what the upstream actually received. */
interface Received {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

async function startServer(handler: (received: Received) => Response | Promise<Response>) {
  const { createServer } = await import('node:http');
  const received: Received[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const record: Received = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(',') : (v ?? ''),
          ]),
        ),
        body: Buffer.concat(chunks).toString('utf8'),
      };
      received.push(record);
      Promise.resolve(handler(record))
        .then(async (response) => {
          const payload = response.body ? Buffer.from(await response.text()) : undefined;
          response.headers.forEach((value, key) => res.appendHeader(key, value));
          res.writeHead(response.status);
          res.end(payload);
        })
        .catch((error: Error) => {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(error.message);
        });
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const address = srv.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { received, port, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

beforeAll(async () => {
  server = await startServer(upstream);
  process.env.API_INTERNAL_URL = `http://127.0.0.1:${server.port}`;
  vi.resetModules();
  handlers = await import('@/app/api/v1/[...path]/route');
  // The global setup starts MSW with onUnhandledRequest:'error' to catch
  // un-stubbed calls in component tests. Here it would intercept the proxy's own
  // server-side fetch, and since that strategy also forbids passthrough, the
  // only way to test the real thing is to stop intercepting. Vitest isolates
  // test files, so this does not weaken the guard in any other file.
  msw.close();
});

afterAll(async () => {
  await server.close();
  msw.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  upstream.mockReset();
});

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('API proxy', () => {
  it('forwards the method, path and query string', async () => {
    upstream.mockReturnValue(json({ success: true, data: {} }));
    const res = await handlers.GET(
      new Request('http://localhost/api/v1/public/facilities?type=CLINIC&page=2'),
      context(['public', 'facilities']),
    );

    expect(res.status).toBe(200);
    const seen = server.received.at(-1);
    expect(seen?.method).toBe('GET');
    expect(seen?.url).toBe('/public/facilities?type=CLINIC&page=2');
  });

  it('returns the upstream status rather than flattening it to 200', async () => {
    upstream.mockReturnValue(json({ success: false }, { status: 409 }));
    const res = await handlers.GET(new Request('http://localhost/api/v1/x'), context(['x']));
    expect(res.status).toBe(409);
  });

  it('forwards the session cookie so the request stays authenticated', async () => {
    upstream.mockReturnValue(json({ success: true, data: {} }));
    await handlers.GET(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { cookie: 'careos_session=abc123; other=1' },
      }),
      context(['auth', 'me']),
    );
    expect(server.received.at(-1)?.headers.cookie).toBe('careos_session=abc123; other=1');
  });

  it('rebinds an upstream Set-Cookie to our origin so the session is not dropped', async () => {
    upstream.mockReturnValue(
      json(
        { success: true },
        {
          headers: {
            'content-type': 'application/json',
            'set-cookie':
              'careos_session=v; Domain=api.internal.example; Path=/; HttpOnly; Secure; SameSite=Lax',
          },
        },
      ),
    );
    const res = await handlers.GET(
      new Request('http://localhost/api/v1/auth/login'),
      context(['auth', 'login']),
    );
    const cookie = res.headers.get('set-cookie') ?? '';

    expect(cookie).toContain('careos_session=v');
    // Domain removed so the browser binds it to this host.
    expect(cookie).not.toMatch(/domain=/i);
    // Security attributes must survive untouched.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('forwards a request body intact on writes', async () => {
    upstream.mockReturnValue(json({ success: true, data: {} }, { status: 201 }));
    const body = JSON.stringify({ patientName: 'Test', urgency: 'ROUTINE' });
    const res = await handlers.POST(
      new Request('http://localhost/api/v1/public/emergency-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      context(['public', 'emergency-requests']),
    );

    expect(res.status).toBe(201);
    expect(server.received.at(-1)?.body).toBe(body);
    expect(server.received.at(-1)?.method).toBe('POST');
  });

  it('does not forward hop-by-hop or host headers upstream', async () => {
    upstream.mockReturnValue(json({ success: true, data: {} }));
    await handlers.GET(
      new Request('http://localhost/api/v1/x', {
        headers: { 'transfer-encoding': 'chunked', 'x-trace': 'keep-me' },
      }),
      context(['x']),
    );
    const headers = server.received.at(-1)?.headers ?? {};
    expect(headers['x-trace']).toBe('keep-me');
    expect(headers.host).not.toBe('localhost');
  });

  it('attaches a request id so a failure can be traced end to end', async () => {
    upstream.mockReturnValue(json({ success: true, data: {} }));
    const res = await handlers.GET(new Request('http://localhost/api/v1/x'), context(['x']));
    const id = res.headers.get('x-request-id');
    expect(id).toBeTruthy();
    expect(server.received.at(-1)?.headers['x-request-id']).toBe(id);
  });

  it('returns a typed error envelope when the upstream is unreachable', async () => {
    // Points at a port with nothing listening.
    const saved = process.env.API_INTERNAL_URL;
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:1';
    vi.resetModules();
    const unreachable = await import('@/app/api/v1/[...path]/route');

    const res = await unreachable.GET(new Request('http://localhost/api/v1/x'), context(['x']));
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
      meta: { requestId: string };
    };

    // 502, shaped like the API's own envelope, so the client has one error path.
    expect(res.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.meta.requestId).toBeTruthy();

    process.env.API_INTERNAL_URL = saved;
    vi.resetModules();
  });

  it('never caches a clinical response', async () => {
    upstream.mockReturnValue(json({ success: true, data: {} }));
    const res = await handlers.GET(new Request('http://localhost/api/v1/x'), context(['x']));
    expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/i);
  });
});
