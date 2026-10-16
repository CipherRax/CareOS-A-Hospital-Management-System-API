import { AnalyticsScreen } from '@/components/analytics/analytics-dashboard';

/**
 * /analytics — the operational-metrics dashboard (F10 analytics & reports).
 *
 * `GET /analytics/metrics` is typed `unknown` (a large nested object), so the
 * series and summary are validated structurally in `src/lib/data/analytics.ts`
 * and the point-in-time snapshots are rendered generically. Reporting windows
 * default on the service, so the screen opens with no query string.
 */
export default function AnalyticsPage() {
  return <AnalyticsScreen />;
}
