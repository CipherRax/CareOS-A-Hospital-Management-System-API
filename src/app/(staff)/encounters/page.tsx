import { EncounterListScreen } from '@/components/staff/encounter-list';

/**
 * /encounters — doctor workspace encounter list (F4).
 *
 * The list 200 is mis-typed as the request DTO and the query is unmodelled
 * (GAP-020), so rows are validated structurally in `src/lib/data/encounters.ts`.
 * Rows carry only `patientId`; names resolve on demand (GAP-018).
 */
export default function EncountersPage() {
  return <EncounterListScreen />;
}