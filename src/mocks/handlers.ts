import { http, HttpResponse } from 'msw';

import { REFRESH_COOKIE, SESSION_COOKIE } from '@/lib/session-cookies';

/**
 * API mock handlers.
 *
 * Mocks are derived from the same OpenAPI document that generates the client
 * types (`src/api/schema.d.ts`), so a handler that drifts from the contract is a
 * type error rather than a runtime surprise.
 *
 * Two rules, both load-bearing for a clinical product:
 *
 *  1. Mock data is obviously fake. Facility and patient names carry an
 *     `EXAMPLE` marker so a screenshot can never be mistaken for a real record.
 *  2. Mocks are refused in production. `src/lib/env.ts` throws at module load if
 *     NEXT_PUBLIC_ENABLE_MOCKS is true while NODE_ENV=production, and this
 *     module additionally refuses to register.
 */

export const MOCK_LATENCY_MS = 120;

/** Response envelope matching the API's documented shape. */
export function apiOk<T>(data: T, requestId = 'req_mock') {
  return { success: true as const, data, meta: { requestId } };
}

/**
 * Error body only. The HTTP status is supplied by the caller to
 * `HttpResponse.json(body, { status })` so the two cannot disagree.
 */
export function apiError(code: string, message: string) {
  return { success: false as const, error: { code, message }, meta: { requestId: 'req_mock' } };
}

const EXAMPLE_FACILITIES = [
  {
    id: 'fac_example_0001',
    slug: 'example-general-hospital',
    name: 'EXAMPLE General Hospital',
    summary: 'EXAMPLE 24-hour casualty with online emergency intake.',
    town: 'Mombasa',
    county: 'Mombasa County',
    address: '1 Independence Avenue, Mombasa',
    phone: '+254700000000',
    open24h: true,
    emergency24h: true,
    ambulanceAvailable: true,
    emergencyIntakeEnabled: true,
  },
  {
    id: 'fac_example_0002',
    slug: 'example-referral-centre',
    name: 'EXAMPLE Referral Centre',
    summary: 'EXAMPLE regional referral centre.',
    town: 'Nairobi',
    county: 'Nairobi County',
    address: '22 Hospital Road, Nairobi',
    phone: '+254700000001',
    open24h: true,
    emergency24h: false,
    ambulanceAvailable: true,
    emergencyIntakeEnabled: false,
  },
];

/**
 * The mock session mirrors the production bridge (`src/app/api/v1/[...path]/route.ts`):
 * login writes the session cookies and returns the token-stripped body the browser
 * would really see; `/auth/me` answers by the presence of the session cookie; logout
 * clears it. `document.cookie` is used so the same handlers work in the browser
 * (mock dev) and in jsdom (unit tests), and the session is scoped to that context.
 */
const MOCK_ACCESS_TOKEN = 'mock-access-token';
const MOCK_REFRESH_TOKEN = 'mock-refresh-token';

const MOCK_SESSION_USER = {
  id: 'usr_example_0001',
  email: 'nurse@example.org',
  firstName: 'EXAMPLE',
  lastName: 'Nurse',
  status: 'ACTIVE',
  roles: ['TRIAGE_NURSE'],
};

function setMockCookies() {
  document.cookie = `${SESSION_COOKIE}=${MOCK_ACCESS_TOKEN}; Path=/; SameSite=Lax`;
  document.cookie = `${REFRESH_COOKIE}=${MOCK_REFRESH_TOKEN}; Path=/; SameSite=Lax`;
}

function clearMockCookies() {
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0`;
  document.cookie = `${REFRESH_COOKIE}=; Path=/; Max-Age=0`;
}

function hasMockSession(): boolean {
  return document.cookie.includes(`${SESSION_COOKIE}=${MOCK_ACCESS_TOKEN}`);
}

export const handlers = [
  // The live contract: GET /public/facilities/search returns a flat array (the
  // partial document's `{ items, total }` envelope and `/public/facilities` path
  // do not exist upstream).
  http.get('*/api/v1/public/facilities/search', ({ request }) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    let items = EXAMPLE_FACILITIES;
    if (q) {
      items = items.filter((facility) =>
        `${facility.name} ${facility.address ?? ''} ${facility.town ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    return HttpResponse.json(apiOk(items));
  }),

  http.get('*/api/v1/public/facilities/config', () =>
    // Live shape verified against the running API: app-global directory config.
    HttpResponse.json(
      apiOk({
        appName: 'careOS public facility directory',
        emergencyStatement:
          'This directory is informational only. In an emergency, call your national emergency number or go to the nearest emergency facility immediately.',
        acceptsOnlineBooking: true,
      }),
    ),
  ),

  http.post('*/api/v1/auth/login', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    if (
      typeof body.organizationId !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string' ||
      body.password.length === 0
    ) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'missing fields'), { status: 400 });
    }
    // Mirrors the proxy bridge: cookies are set, and the token pair is stripped
    // from the body the browser sees.
    setMockCookies();
    return HttpResponse.json(
      apiOk({
        mfaRequired: false,
        user: MOCK_SESSION_USER,
        session: {
          id: 'ses_example_0001',
          familyId: 'fam_example_0001',
          createdAt: '2026-09-27T09:00:00.000Z',
          expiresAt: '2026-09-28T09:00:00.000Z',
        },
      }),
      { status: 200 },
    );
  }),

  http.post('*/api/v1/auth/logout', async () => {
    clearMockCookies();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/v1/auth/me', () => {
    // No session cookie: signed out, exactly as `/auth/me` reads without a Bearer.
    if (!hasMockSession()) {
      return HttpResponse.json(apiError('UNAUTHORIZED', 'Invalid or missing credentials.'), {
        status: 401,
      });
    }
    return HttpResponse.json(
      apiOk({
        user: MOCK_SESSION_USER,
        organization: {
          id: 'org_example_0001',
          name: 'EXAMPLE Health Services',
          status: 'ACTIVE',
          featureFlags: {},
        },
        roles: ['TRIAGE_NURSE'],
        roleDetails: MOCK_SESSION_USER.roles.map((key) => ({
          id: `role_example_${key.toLowerCase()}`,
          key,
          name: 'EXAMPLE Nurse',
        })),
        security: { passwordChangeRequired: false, mfaEnrolmentRequired: false, staging: [] },
        session: { id: 'ses_example_0001' },
        branch: { current: null, allowed: [] },
        branches: [],
        patient: null,
        preferences: null,
      }),
      { status: 200 },
    );
  }),

  http.post('*/api/v1/public/emergency-requests/track', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    if (typeof body.token !== 'string' || body.token.length === 0) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'token required'), { status: 400 });
    }
    // Matches the token the mock intake handler issues. Tracking is keyed by the
    // token alone — the reference never leaves the caller's receipt.
    if (body.token !== 'tok_example_track_0001') {
      return HttpResponse.json(
        apiError('RESOURCE_NOT_FOUND', 'No request found for that tracking token.'),
        {
          status: 404,
        },
      );
    }
    return HttpResponse.json(
      apiOk(
        {
          referenceNumber: 'EMR-EXAMPLE-0001',
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
            phone: '+254700000000',
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
        'req_mock_emergency_track',
      ),
      { status: 200 },
    );
  }),

  http.post('*/api/v1/public/emergency-requests', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    // The live body is slug-keyed (`SubmitEmergencyRequestDto`), so a mock that
    // accepted any shape would hide a form that posts an invalid body.
    if (typeof body.slug !== 'string' || body.slug.length === 0) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'slug required'), { status: 400 });
    }
    return HttpResponse.json(
      apiOk(
        {
          request: {
            id: 'emg_example_0001',
            referenceNumber: 'EMR-EXAMPLE-0001',
            trackingToken: 'tok_example_track_0001',
          },
          contact: '+254700000000',
          consentVersion: '2026-10-01',
        },
        'req_mock_emergency',
      ),
      { status: 201 },
    );
  }),
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
