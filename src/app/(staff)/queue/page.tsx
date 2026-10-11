import { QueueBoardScreen } from '@/components/staff/queue-board';

/**
 * /queue — reception queue board (F3).
 *
 * The board reads `GET /queue`, whose 200 the export mis-types as the request DTO
 * (GAP-017), so rows are validated structurally. Actions follow the API's own
 * transition graph; the walk-in panel takes tickets through the same endpoint as
 * the registry's registration.
 */
export default function QueuePage() {
  return <QueueBoardScreen />;
}
