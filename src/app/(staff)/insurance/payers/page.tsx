import { PayersWorklistScreen } from '@/components/staff/payers-worklist';

/**
 * /insurance/payers — insurance payers (F7).
 *
 * `GET /insurance/payers` types its 200 as the bare entity while the service
 * answers a `PageResult` (GAP-020), so rows are validated structurally in
 * `src/lib/data/insurance.ts`.
 */
export default function InsurancePayersPage() {
  return <PayersWorklistScreen />;
}
