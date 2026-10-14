import { AdmissionsWorklistScreen } from '@/components/staff/admissions-worklist';

/**
 * /admissions — admissions desk (F8 slice 2).
 *
 * `GET /admissions` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/inpatient.ts`. Each admission carries its bed-assignment history,
 * so the current bed is resolved from the ward tree rather than a second read.
 */
export default function AdmissionsPage() {
  return <AdmissionsWorklistScreen />;
}
