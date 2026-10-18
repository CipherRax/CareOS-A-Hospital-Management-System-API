import { http, HttpResponse } from 'msw';

import {
  PORTAL_APPOINTMENTS,
  PORTAL_LAB_RESULTS,
  PORTAL_PATIENT,
  PORTAL_PATIENT_ID,
} from '@/mocks/fixtures/portal-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';
import { SESSION_COOKIE } from '@/lib/session-cookies';
import { PORTAL_FEEDBACK_CATEGORIES } from '@/lib/data/portal';

/**
 * F11 patient-portal handlers.
 *
 * Self-scoped like the live API: there is no id in the path because the patient
 * is derived from the session, so there is nothing here for a caller to tamper
 * with. A request without the session cookie is signed out, matching the stub.
 */

const MOCK_ACCESS_TOKEN = 'mock-access-token';

function hasSession(): boolean {
  return document.cookie.includes(`${SESSION_COOKIE}=${MOCK_ACCESS_TOKEN}`);
}

export function portalHandlers() {
  return [
    http.get('*/api/v1/portal/me', async () => {
      await delay(MOCK_LATENCY_MS);
      if (!hasSession()) {
        return HttpResponse.json(apiError('UNAUTHORIZED', 'Invalid or missing credentials.'), {
          status: 401,
        });
      }
      return HttpResponse.json(apiOk({ patient: { ...PORTAL_PATIENT } }));
    }),
    http.get('*/api/v1/portal/me/appointments', async () => {
      await delay(MOCK_LATENCY_MS);
      if (!hasSession()) {
        return HttpResponse.json(apiError('UNAUTHORIZED', 'Invalid or missing credentials.'), {
          status: 401,
        });
      }
      const items = PORTAL_APPOINTMENTS.map((appointment) => ({ ...appointment }));
      return HttpResponse.json(apiPage(items, items.length, 25));
    }),
    http.get('*/api/v1/portal/me/lab-results', async () => {
      await delay(MOCK_LATENCY_MS);
      if (!hasSession()) {
        return HttpResponse.json(apiError('UNAUTHORIZED', 'Invalid or missing credentials.'), {
          status: 401,
        });
      }
      const items = PORTAL_LAB_RESULTS.map((result) => ({ ...result }));
      return HttpResponse.json(apiPage(items, items.length, 25));
    }),
    http.post('*/api/v1/portal/me/feedback', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      if (!hasSession()) {
        return HttpResponse.json(apiError('UNAUTHORIZED', 'Invalid or missing credentials.'), {
          status: 401,
        });
      }
      const body = (await request.json().catch(() => null)) as {
        category?: unknown;
        rating?: unknown;
        comment?: unknown;
      } | null;
      const categoryOk =
        body?.category != null && PORTAL_FEEDBACK_CATEGORIES.includes(body.category as never);
      const ratingOk = typeof body?.rating === 'number' && body.rating >= 1 && body.rating <= 5;
      if (!body || !categoryOk || !ratingOk) {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'Invalid feedback payload.'), {
          status: 400,
        });
      }
      // The patient id is stamped server-side from the session, never read from the body.
      return HttpResponse.json(
        apiOk({
          id: 'fb_example_0001',
          organizationId: 'org_example_1',
          branchId: null,
          patientId: PORTAL_PATIENT_ID,
          submittedById: null,
          category: body.category,
          rating: body.rating,
          comment: typeof body.comment === 'string' ? body.comment : null,
          status: 'NEW',
          response: null,
          handledById: null,
          handledAt: null,
          createdAt: '2026-02-14T10:00:00.000Z',
          updatedAt: '2026-02-14T10:00:00.000Z',
        }),
        { status: 201 },
      );
    }),
  ];
}
