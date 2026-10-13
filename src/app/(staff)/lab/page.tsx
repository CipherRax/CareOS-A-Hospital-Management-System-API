import { LabWorklistScreen } from '@/components/staff/lab-worklist';

/**
 * /lab — laboratory worklist (F5).
 *
 * The list 200 is mis-typed as the request DTO and the query is unmodelled
 * (GAP-020), so rows are validated structurally in `src/lib/data/laboratory.ts`.
 * Rows carry only `patientId`; names resolve on demand (GAP-018).
 */
export default function LabPage() {
  return <LabWorklistScreen />;
}
