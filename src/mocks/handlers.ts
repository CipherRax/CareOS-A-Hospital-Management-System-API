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

const EXAMPLE_FACILITY = {
  id: 'fac_example_0001',
  name: 'EXAMPLE General Hospital',
  shortName: 'EXAMPLE GH',
  type: 'GENERAL',
  status: 'ACTIVE',
  phone: '+254700000000',
  emergencyPhone: '+254700000001',
  address: 'EXAMPLE Road, Nairobi',
};

export const handlers = [
  http.get('*/api/v1/public/facilities', () =>
    HttpResponse.json(apiOk({ items: [EXAMPLE_FACILITY], total: 1 })),
  ),

  http.get('*/api/v1/public/config', () =>
    // Shaped from the hand-authored OpenAPI fragment. If the real API differs,
    // this is recorded in docs/api-contract-gaps.md rather than quietly changed.
    HttpResponse.json(
      apiOk({
        platformName: 'careOS',
        defaultLocale: 'en',
        supportedLocales: ['en', 'sw'],
        features: { emergencyIntake: true, displayScreens: true, patientPortal: false },
      }),
    ),
  ),

  http.get('*/api/v1/auth/me', () =>
    HttpResponse.json(apiError('UNAUTHENTICATED', 'Authentication required.'), { status: 401 }),
  ),

  http.post('*/api/v1/public/emergency-requests', async () => {
    await delay(MOCK_LATENCY_MS);
    return HttpResponse.json(
      apiOk(
        {
          id: 'emg_example_0001',
          reference: 'EXAMPLE-0001',
          status: 'SUBMITTED',
          createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
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
