import { UsersWorklistScreen } from '@/components/staff/users-worklist';

/**
 * /users — user directory (F9 administration).
 *
 * `GET /users` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/admin.ts`. Inviting posts to `POST /users`.
 */
export default function UsersPage() {
  return <UsersWorklistScreen />;
}
