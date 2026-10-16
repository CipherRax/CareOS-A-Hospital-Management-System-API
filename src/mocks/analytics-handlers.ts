import { http, HttpResponse } from 'msw';

import { ANALYTICS_BOTTLENECK, ANALYTICS_CAPACITY, ANALYTICS_METRICS } from '@/mocks/fixtures/analytics-registry';
import { apiOk, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F10 analytics handlers.
 *
 * The metrics, bottleneck and capacity responses are large, nested,
 * `unknown`-typed payloads. Each mock echoes the requested window back into the
 * fixture's period (and scope for metrics) so a chosen window is reflected in
 * the page, exactly as the service does, without recomputing the body.
 */
function echoWindow(fixture: { period: { from: string; to: string } }, url: URL) {
  return {
    ...fixture,
    period: {
      from: url.searchParams.get('from') ?? fixture.period.from,
      to: url.searchParams.get('to') ?? fixture.period.to,
    },
  };
}

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
    http.get('*/api/v1/analytics/bottleneck', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      return HttpResponse.json(apiOk(echoWindow(ANALYTICS_BOTTLENECK, new URL(request.url))));
    }),
    http.get('*/api/v1/analytics/capacity', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      return HttpResponse.json(apiOk(echoWindow(ANALYTICS_CAPACITY, new URL(request.url))));
    }),
  ];
}
