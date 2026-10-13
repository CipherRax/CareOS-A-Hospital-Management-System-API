import { RadiologyWorklistScreen } from '@/components/staff/radiology-worklist';

/**
 * /radiology — radiology worklist (F5).
 *
 * The list 200 is mis-typed as the request DTO and the query is unmodelled
 * (GAP-020), so rows are validated structurally in `src/lib/data/radiology.ts`.
 * Rows carry only `patientId`; names resolve on demand (GAP-018).
 */
export default function RadiologyPage() {
  return <RadiologyWorklistScreen />;
}
