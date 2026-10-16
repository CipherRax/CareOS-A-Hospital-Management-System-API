import { ReportsWorklistScreen } from '@/components/reports/reports-worklist';

/**
 * /reports — the report-export desk (F10 analytics & reports).
 *
 * `GET /reports/exports` types its 200 as the request DTO while the service
 * answers a `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/reports.ts`. The request form queues a new export; it settles on
 * its detail screen.
 */
export default function ReportsPage() {
  return <ReportsWorklistScreen />;
}
