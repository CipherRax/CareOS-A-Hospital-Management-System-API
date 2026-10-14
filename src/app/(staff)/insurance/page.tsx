import { InsuranceWorklistScreen } from '@/components/staff/insurance-worklist';

/**
 * /insurance — insurance claims desk (F7).
 *
 * `GET /insurance/claims` is a thin projection whose 200 is mis-typed as the
 * request DTO (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/insurance.ts`. Rows carry only `patientId`; names resolve on
 * demand (GAP-018).
 */
export default function InsurancePage() {
  return <InsuranceWorklistScreen />;
}
