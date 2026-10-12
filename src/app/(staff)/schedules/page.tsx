import { ScheduleAdminScreen } from '@/components/staff/schedule-admin';

/**
 * /schedules — schedule administration (F3).
 *
 * Reads `GET /schedules/templates`, mis-typed and unmodelled in the export
 * (GAP-017), so the week is validated structurally. The API has no endpoint to
 * list date overrides (GAP-019), so the screen can add an exception but cannot
 * enumerate the ones already set.
 */
export default function SchedulesPage() {
  return <ScheduleAdminScreen />;
}
