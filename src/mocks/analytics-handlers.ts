import { http, HttpResponse } from 'msw';

import { ANALYTICS_METRICS } from '@/mocks/fixtures/analytics-registry';
import { apiOk, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F10 analytics handlers.
 *
 * The metrics response is a large, nested, `unknown`-typed payload. The mock
 * echoes the requested window and granularity back into the fixture's period and
 * scope so a chosen window is reflected in the page, exactly as the service does,
 * without recomputing the series.
 */
export function analyticsHandlers() {
  return [
    http.get('*/api/v1/analytics/metrics', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const granularity = url.searchParams.get('granularity');
      const branchId = url.searchParams.get('branchId');
      const departmentId = url.searchParams.get('departmentId');

      return HttpResponse.json(
        apiOk({
          ...ANALYTICS_METRICS,
          scope: { branchId: branchId ?? null, departmentId: departmentId ?? null },
          period: {
            from: from ?? ANALYTICS_METRICS.period.from,
            to: to ?? ANALYTICS_METRICS.period.to,
          },
          granularity: granularity ?? ANALYTICS_METRICS.granularity,
        }),
      );
    }),
  ];
}
