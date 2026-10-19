import { FeedbackWorklistScreen } from '@/components/staff/quality-worklists';

/**
 * /quality/feedback — the feedback desk (brief Phase 10).
 *
 * `GET /feedback` is declared as the item response DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/quality.ts`.
 */
export default function QualityFeedbackPage() {
  return <FeedbackWorklistScreen />;
}
