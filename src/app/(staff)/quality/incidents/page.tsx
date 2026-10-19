import { IncidentsWorklistScreen } from '@/components/staff/quality-worklists';

/**
 * /quality/incidents — the incidents desk (brief Phase 10).
 *
 * `GET /incidents` fastens the request DTO onto its 200 while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/quality.ts`.
 */
export default function QualityIncidentsPage() {
  return <IncidentsWorklistScreen />;
}
