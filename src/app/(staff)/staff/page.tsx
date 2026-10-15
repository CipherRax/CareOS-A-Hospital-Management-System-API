import { StaffWorklistScreen } from '@/components/staff/staff-worklist';

/**
 * /staff — the staff directory (F9 administration).
 *
 * `GET /staff` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/staff.ts`. Profiles are created with a user, so this screen only
 * lists and links into the workspace.
 */
export default function StaffPage() {
  return <StaffWorklistScreen />;
}
