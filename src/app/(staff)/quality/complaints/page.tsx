import { ComplaintsWorklistScreen } from '@/components/staff/quality-worklists';

/**
 * /quality/complaints — the complaints desk (brief Phase 10).
 *
 * `GET /complaints` fastens the request DTO onto its 200 while the service answers
 * a `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/quality.ts`. Assignment is shown as a state, not a name: naming the
 * assignee needs a staff-directory read this desk does not make.
 */
export default function QualityComplaintsPage() {
  return <ComplaintsWorklistScreen />;
}
