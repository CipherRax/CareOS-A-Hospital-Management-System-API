import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';

/** Parses `fastify.printRoutes()` output into { method, path } entries. */
export function parseFastifyRoutes(
  tree: string,
): Array<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string }> {
  const routes: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
  }> = [];
  const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

  // path prefix accumulated per tree depth (single string, so a node name may
  // itself contain '/', e.g. 'api/v1/').
  const prefixAtDepth: Record<number, string> = {};

  for (const line of tree.split('\n').filter((l) => l.trim().length > 0)) {
    const connectorAt = line.lastIndexOf('── ');
    if (connectorAt < 0) continue;

    let nameStart = connectorAt + 3;
    while (line[nameStart] === ' ') nameStart++;
    const depth = nameStart / 4 - 1;
    if (depth <= 0) continue; // skip the synthetic empty root

    const rest = line.slice(nameStart).trim();
    const suffix = rest.match(/\s*\((.*)\)\s*$/);
    const name = suffix ? rest.slice(0, suffix.index ?? 0) : rest;
    if (name.includes('*')) continue; // fastify/Fastify-route wildcard (CORS), not ours

    const methods = suffix
      ? (suffix[1] ?? '')
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m && KNOWN_METHODS.has(m))
      : [];

    const full = `${prefixAtDepth[depth - 1] ?? ''}${name}`.replace(/^\/\/|\/+$/g, '/');

    if (methods.length === 0) {
      prefixAtDepth[depth] = full;
    } else {
      prefixAtDepth[depth] = full;
      for (const method of methods) {
        const typed = method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        if (!routes.some((r) => r.method === typed && r.path === full)) {
          routes.push({ method: typed, path: full });
        }
      }
    }
  }

  return routes;
}

describe('app boot + envelope + deny-by-default (Phase 0 acceptance)', () => {
  let app: NestFastifyApplication;
  let env: Env;

  beforeAll(async () => {
    app = await createTestApp(); // no test principal → empty scope on all routes
    env = app.get(ENV);
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes a live endpoint at the root', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      success: true,
      data: { status: 'ok', uptime: expect.any(Number), timestamp: expect.any(String) },
    });
  });

  it('readiness checks PostgreSQL and Redis and reports healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.details.database.status).toBe('up');
    expect(body.data.details.redis.status).toBe('up');
  });

  it('wraps errors in the standard envelope with a typed code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${env.API_PREFIX}/organizations/me`,
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PERMISSION_DENIED');
    expect(body.error.message).toBe('Forbidden');
  });

  it('route-walk: every non-public route is denied without a principal (deny by default)', async () => {
    const fastify = app.getHttpAdapter().getInstance() as { printRoutes: () => string };
    const tree = fastify.printRoutes();
    const routes = parseFastifyRoutes(tree);
    expect(routes.length).toBeGreaterThan(0);

    const publicPaths = new Set<string>(['/health', '/health/live', '/health/ready']);
    const failures: string[] = [];

    for (const route of routes) {
      if (publicPaths.has(route.path)) continue;
      const res = await app.inject({
        method: route.method,
        url: route.path,
        payload: route.method !== 'GET' && route.method !== 'DELETE' ? {} : undefined,
      });
      // Deny-by-default: protected routes must not return 2xx without metadata.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        failures.push(`${route.method} ${route.path} → ${res.statusCode}`);
      }
    }

    // All protected routes answered 4xx under an empty scope.
    expect(failures).toEqual([]);
  });

  it('public health routes respond outside the API prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect([200, 503]).toContain(res.statusCode);
  });
});
