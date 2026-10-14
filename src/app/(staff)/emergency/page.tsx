import { EmergencyWorklistScreen } from '@/components/staff/emergency-worklist';

/**
 * /emergency — emergency desk (F8 slice 3).
 *
 * `GET /emergency/visits` types its 200 as the request DTO while the service
 * answers a `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/emergency.ts`. Today's metrics come from `GET /emergency/summary`.
 */
export default function EmergencyPage() {
  return <EmergencyWorklistScreen />;
}
