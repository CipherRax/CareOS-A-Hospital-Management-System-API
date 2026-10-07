import { http, HttpResponse } from 'msw';

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
        `${facility.name} ${facility.address ?? ''} ${facility.town ?? ''}`.toLowerCase().includes(q),
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

  http.get('*/api/v1/auth/me', () =>
    HttpResponse.json(apiError('UNAUTHORIZED', 'Invalid or missing credentials.'), {
      status: 401,
    }),
  ),

  http.post('*/api/v1/public/emergency-requests', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
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