import { WardWorklistScreen } from '@/components/staff/ward-worklist';

/**
 * /wards — ward board worklist (F8).
 *
 * `GET /wards` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/inpatient.ts`. Each ward carries its rooms and beds nested, so
 * occupancy is derived from the row itself.
 */
export default function WardsPage() {
  return <WardWorklistScreen />;
}
