import { http, HttpResponse } from 'msw';

import { PORTAL_PATIENT } from '@/mocks/fixtures/portal-registry';
import { apiError, apiOk, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';
import { SESSION_COOKIE } from '@/lib/session-cookies';

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
  ];
}
