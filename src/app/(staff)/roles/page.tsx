import { RolesWorklistScreen } from '@/components/staff/roles-worklist';

/**
 * /roles — role directory (F9 administration).
 *
 * `GET /roles` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/admin.ts`. Creating and editing a role happen on their own
 * screens because the permission editor needs the full catalogue.
 */
export default function RolesPage() {
  return <RolesWorklistScreen />;
}
