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

/**
 * The signed-in persona. Everything here is fabricated on a real envelope.
 *
 * `/auth/me` returns `data` in the live shape (`user` + `roles`/`roleDetails`,
 * `organization`, `security`, `session`, …) so the frontend's `normaliseSessionUser`
 * has a real body to read. Login returns the token pair *in the response body* —
 * this stub sits *upstream* of the proxy, and the proxy is what lifts the pair
 * into HttpOnly cookies and strips it from what the browser sees. The header then
 * reads `EXAMPLE Dr N. Wanjiru` (firstName + otherNames + lastName).
 */
const USER = {
  user: {
    id: 'usr-example-1',
    email: 'registrar@example.org',
    firstName: 'EXAMPLE Dr',
    otherNames: 'N.',
    lastName: 'Wanjiru',
    status: 'ACTIVE',
  },
  roles: [{ id: 'role-example-1', key: 'REGISTRAR', name: 'Registrar' }],
  roleDetails: [{ id: 'role-example-1', key: 'REGISTRAR', name: 'Registrar' }],
  organization: {
    id: 'org-example-1',
    name: 'EXAMPLE Teaching Hospital',
    status: 'ACTIVE',
    featureFlags: {},
  },
  security: { passwordChangeRequired: false, mfaEnrolmentRequired: false, staging: [] },
  session: { id: 'ses-example-1', familyId: 'fam-example-1' },
  branch: { current: null, allowed: [] },
  branches: [],
  patient: null,
  preferences: null,
};

const SESSION = {
  id: 'ses-example-1',
  familyId: 'fam-example-1',
  createdAt: '2026-09-27T09:00:00.000Z',
  expiresAt: '2026-09-28T09:00:00.000Z',
};

/** The only token pair the stub accepts. The proxy mirrors it into cookies. */
const TOKENS = {
  accessToken: 'careos-e2e-access-token',
  refreshToken: 'careos-e2e-refresh-token',
  expiresIn: 900,
  refreshTokenExpiresAt: '2026-12-31T00:00:00.000Z',
};

/**
 * The MFA-secured persona. Login for this account answers with a single-use
 * challenge and no tokens; `POST /auth/mfa/verify` completes it (code 123456 or
 * the recovery code `RECOVERY-RSTV-4AK3-9M`) and returns the same session
 * envelope a non-MFA login would, so the proxy lifts the pair exactly as it
 * does for `/auth/login`.
 */
const MFA_EMAIL = 'mfa@example.org';
const MFA_CHALLENGE_TOKEN = 'careos-e2e-mfa-challenge';
const MFA_CODE = '123456';
const MFA_RECOVERY_CODE = 'RECOVERY-RSTV-4AK3-9M';

function send(response, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });
}

const server = createServer(async (request, response) => {
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
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'No request found for that tracking token',
          },
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

  if (url.pathname === '/auth/login' && request.method === 'POST') {
    // The live contract posts `LoginDto` (organizationId, email, password). The
    // stub validates as strictly as the API so a test that posts a malformed
    // body fails loudly instead of silently getting a session.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    if (
      typeof parsed.organizationId !== 'string' ||
      parsed.organizationId.length === 0 ||
      typeof parsed.email !== 'string' ||
      parsed.email.length === 0 ||
      typeof parsed.password !== 'string' ||
      parsed.password.length === 0
    ) {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'invalid' },
      });
      return;
    }

    if (parsed.email === MFA_EMAIL) {
      send(response, 200, {
        success: true,
        data: {
          mfaRequired: true,
          challengeToken: MFA_CHALLENGE_TOKEN,
          challengeExpiresIn: 300,
        },
      });
      return;
    }

    send(response, 200, {
      success: true,
      data: {
        mfaRequired: false,
        user: USER.user,
        session: SESSION,
        tokens: TOKENS,
      },
    });
    return;
  }

  if (url.pathname === '/auth/mfa/verify' && request.method === 'POST') {
    // Mirrors the live DTO: a challenge token plus one of { TOTP code, recovery
    // code }. A wrong challenge or wrong code is a 401, exactly as the API
    // answers, so the test proves the form shows the refusal without admitting
    // the session.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const recovery =
      typeof parsed.recoveryCode === 'string'
        ? parsed.recoveryCode.trim().toUpperCase().replace(/\s+/g, '')
        : '';
    if (
      parsed.challengeToken !== MFA_CHALLENGE_TOKEN ||
      (code !== MFA_CODE && recovery !== MFA_RECOVERY_CODE)
    ) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }

    send(response, 200, {
      success: true,
      data: {
        user: USER.user,
        session: SESSION,
        tokens: TOKENS,
      },
    });
    return;
  }

  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    // The proxy fills in the refresh token from the cookie; the browser can never
    // know it. The stub holds the proxy to account: the injected secret must be
    // the one we issued.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    if (parsed.refreshToken !== TOKENS.refreshToken) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === '/auth/me' && request.method === 'GET') {
    // A cookie the stub reads, not a header the app trusts: the application has no
    // idea this switch exists, and the 503 state is reached the way a real visitor
    // reaches it — the proxy forwards the session cookie as `Authorization: Bearer`,
    // and the stub answers by whether it recognises the token.
    const cookies = request.headers.cookie ?? '';

    // Reachable but broken. Distinct from signed-out so the gate can prove it tells
    // the two apart — telling someone to sign in when the API is down wastes a
    // support call and teaches people to ignore the message.
    if (cookies.includes('careos-e2e=unavailable')) {
      send(response, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
      return;
    }

    // Signed out means what it always did here: no usable session. The proxy turns
    // the `careos_session` cookie into this header, so its absence is the absence
    // of a session.
    if (request.headers.authorization !== `Bearer ${TOKENS.accessToken}`) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
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
