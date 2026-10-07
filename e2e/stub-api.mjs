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
 * It answers only the paths the app actually uses, modelled on the exported
 * `openapi/careos.openapi.json` (not the retired partial document). Every other
 * path 404s, so a test that accidentally starts depending on more of the API
 * fails loudly rather than quietly passing against invented data.
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

  // Published facilities, per the live contract: `GET /public/facilities/search`
  // returns a flat `{ success, data: […] }` array (there is no `{ items, total }`
  // envelope and no `/public/facilities` path upstream). The `q` query is the
  // API's real free-text search, exercised here over name/address/town. Facets
  // (`open24h`, `emergency24h`, `ambulanceAvailable`) are the live fields; the
  // partial document's `type`/`status` enums do not exist upstream, so no stub
  // data fabricates them. All records are fabricated.
  const FACILITIES = [
    {
      id: 'fac-example-1',
      slug: 'example-general-hospital',
      name: 'EXAMPLE General Hospital',
      summary: 'EXAMPLE 24-hour casualty with online emergency intake.',
      town: 'Mombasa',
      county: 'Mombasa County',
      address: '1 Independence Avenue, Mombasa',
      phone: '+254 700 000 111',
      open24h: true,
      emergency24h: true,
      ambulanceAvailable: true,
      emergencyIntakeEnabled: true,
    },
    {
      id: 'fac-example-2',
      slug: 'example-referral-centre',
      name: 'EXAMPLE Referral Centre',
      summary: 'EXAMPLE regional referral centre.',
      town: 'Nairobi',
      county: 'Nairobi County',
      address: '22 Hospital Road, Nairobi',
      phone: '+254 700 000 222',
      open24h: true,
      emergency24h: false,
      ambulanceAvailable: true,
      emergencyIntakeEnabled: false,
    },
    {
      id: 'fac-example-3',
      slug: 'example-community-clinic',
      name: 'EXAMPLE Community Clinic',
      summary: 'EXAMPLE daytime community clinic.',
      town: 'Kisumu',
      county: 'Kisumu County',
      address: '3 Market Street, Kisumu',
      open24h: false,
      emergency24h: false,
      ambulanceAvailable: false,
      emergencyIntakeEnabled: false,
    },
  ];
  if (url.pathname === '/public/facilities/search' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    let items = FACILITIES;
    if (q) {
      items = items.filter((facility) =>
        `${facility.name} ${facility.address ?? ''} ${facility.town ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    send(response, 200, { success: true, data: items });
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
    // posts an invalid body. The live body is slug-keyed (`SubmitEmergencyRequestDto`).
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'bad json' },
        });
        return;
      }

      if (typeof parsed.slug !== 'string' || parsed.slug.length === 0) {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid', details: ['slug'] },
        });
        return;
      }

      send(response, 201, {
        success: true,
        data: {
          request: {
            id: 'er-example-1',
            referenceNumber: 'EX-EM-00001',
            trackingToken: 'ex-tok-00001',
          },
          contact: '+254 700 000 111',
          consentVersion: '2026-10-01',
        },
      });
    });
    return;
  }

  if (url.pathname === '/public/emergency-requests/track' && request.method === 'POST') {
    // Tracking is keyed solely by the token the intake receipt issued. The stub
    // answers the live `trackPublic` shape (caller-safe status/copy, facility,
    // national numbers) so the tracker renders the API's words, not ours.
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'bad json' },
        });
        return;
      }

      if (typeof parsed.token !== 'string' || parsed.token.length === 0) {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid', details: ['token'] },
        });
        return;
      }

      if (parsed.token !== 'ex-tok-00001') {
        send(response, 404, {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'No request found for that tracking token' },
        });
        return;
      }

      send(response, 200, {
        success: true,
        data: {
          referenceNumber: 'EX-EM-00001',
          receivedAt: '2026-09-27T10:00:00.000Z',
          status: 'RECEIVED',
          statusLabel: 'Received',
          action: 'WAIT',
          message:
            'We have notified the facility. Keep this token to check again as your request advances.',
          level: 0,
          facility: {
            name: 'EXAMPLE General Hospital',
            slug: 'example-general-hospital',
            phone: '+254 700 000 111',
          },
          serviceArea: 'EXAMPLE metro',
          guidance: null,
          numbers: [
            { purpose: 'emergency', label: 'National emergency', phone: '+254 999', hours: '24/7' },
          ],
          numbersSource: 'seed',
          disclaimer: 'careOS does not dispatch emergency services or guarantee a response time.',
          consentVersion: '2026-10-01',
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
        { success: false, error: { code: 'UNAUTHORIZED' } },
        {
          'set-cookie': 'careos-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        },
      );
      return;
    }

    send(response, 200, { success: true, data: USER });
    return;
  }

  send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-api listening on http://127.0.0.1:${PORT}\n`);
});
