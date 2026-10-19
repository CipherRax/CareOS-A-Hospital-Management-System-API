import { http, HttpResponse } from 'msw';

import {
  QUALITY_COMPLAINTS,
  QUALITY_FEEDBACK,
  QUALITY_INCIDENTS,
} from '@/mocks/fixtures/quality-registry';
import { apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * Quality handlers (feedback, complaints, incidents — brief Phase 10), read side.
 *
 * Each list filters on exactly the query parameters its service does and answers
 * the `pageOf(...)` shape the service returns while the export types something
 * else (GAP-020 family). There are no fixtures for the single-record reads or the
 * status transitions yet; those arrive with the detail workspaces, and inventing
 * endpoints before a screen consumes them would let a test pass against a route
 * the app never calls.
 */
export function qualityHandlers() {
  return [
    http.get('*/api/v1/feedback', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const category = url.searchParams.get('category');
      const rows = QUALITY_FEEDBACK.filter(
        (row) =>
          (!status || row.status === status) && (!category || row.category === category),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),

    http.get('*/api/v1/complaints', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const assignedToId = url.searchParams.get('assignedToId');
      const rows = QUALITY_COMPLAINTS.filter(
        (row) =>
          (!status || row.status === status) &&
          (!assignedToId || row.assignedToId === assignedToId),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),

    http.get('*/api/v1/incidents', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const severity = url.searchParams.get('severity');
      const category = url.searchParams.get('category');
      const rows = QUALITY_INCIDENTS.filter(
        (row) =>
          (!status || row.status === status) &&
          (!severity || row.severity === severity) &&
          (!category || row.category === category),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),
  ];
}
