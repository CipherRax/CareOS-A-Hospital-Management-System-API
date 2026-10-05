/**
 * Stub upstream API for end-to-end tests.
 *
 * The frontend reaches the API through the real `/api/v1` proxy, so without
 * something at the other end `/auth/me` fails and the staff gate — correctly —
 * renders its signed-out page. That would leave the signed-in staff shell with no
 * automated accessibility coverage at all, which is a worse state than having no
 * gate, so the tests stand up this stub instead of weakening the gate.
 *
 * It is a real HTTP server, not a `fetch` stub, so the proxy, cookie handling and
 * error envelope are all genuinely exercised.
 *
 * It answers only endpoints that are actually documented in
 * `openapi/careos.partial.json`. Every other path 404s, so a test that accidentally
 * starts depending on more of the API fails loudly rather than quietly passing
 * against invented data.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_API_PORT ?? 3199);

/** Fabricated. Never a real person, and there is no PHI anywhere in this file. */
const USER = {
  id: 'usr-example-1',
  displayName: 'EXAMPLE Dr N. Wanjiru',
  roleLabel: 'Registrar',
  facilityId: 'fac-example-1',
};

function send(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  // Published facilities, per the documented response shape. Fabricated.
  if (url.pathname === '/public/facilities' && request.method === 'GET') {
    send(response, 200, {
      success: true,
      data: [
        { id: 'fac-example-1', name: 'EXAMPLE General Hospital', type: 'GENERAL' },
        { id: 'fac-example-2', name: 'EXAMPLE Referral Centre', type: 'REFERRAL' },
        { id: 'fac-example-3', name: 'EXAMPLE Community Clinic', type: 'CLINIC' },
      ],
    });
    return;
  }

  if (url.pathname === '/public/emergency-requests' && request.method === 'POST') {
    const cookies = request.headers.cookie ?? '';

    // Rate limited, for the error-path test.
    if (cookies.includes('careos-e2e=rate-limited')) {
      send(response, 429, { success: false, error: { code: 'RATE_LIMITED', message: 'stub' } });
      return;
    }

    // Deliberately validates: the form's own client validation is not the only
    // line of defence, and a stub that accepted anything would hide a form that
    // posts an invalid body.
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'bad json' },
        });
        return;
      }

      const missing = ['facilityId', 'patientName', 'phone', 'description'].filter(
        (key) => typeof parsed[key] !== 'string' || parsed[key].length === 0,
      );
      if (missing.length > 0 || parsed.consentToContact !== true) {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid', details: missing },
        });
        return;
      }

      send(response, 201, {
        success: true,
        data: {
          id: 'er-example-1',
          reference: 'EX-EM-00001',
          status: 'RECEIVED',
          createdAt: '2026-10-05T08:00:00Z',
        },
      });
    });
    return;
  }

  if (url.pathname === '/auth/me' && request.method === 'GET') {
    // A cookie the stub reads, not a header the app trusts: the application has no
    // idea this switch exists, so the signed-out state is reached the way a real
    // visitor reaches it — with no session.
    const cookies = request.headers.cookie ?? '';

    // Reachable but broken. Distinct from signed-out so the gate can prove it tells
    // the two apart — telling someone to sign in when the API is down wastes a
    // support call and teaches people to ignore the message.
    if (cookies.includes('careos-e2e=unavailable')) {
      send(response, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
      return;
    }

    if (cookies.includes('careos-e2e=signed-out')) {
      send(
        response,
        401,
        { success: false, error: { code: 'UNAUTHENTICATED' } },
        {
          'set-cookie': 'careos-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        },
      );
      return;
    }

    send(response, 200, { success: true, data: USER });
    return;
  }

  send(response, 404, { success: false, error: { code: 'NOT_FOUND' } });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-api listening on http://127.0.0.1:${PORT}\n`);
});
