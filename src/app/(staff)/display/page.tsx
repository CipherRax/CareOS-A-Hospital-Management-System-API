import { DisplayBoard } from '@/components/staff/display-board';
import { DISPLAY_BOARD_ENTRIES } from '@/mocks/fixtures/patient';

/**
 * /display — waiting-room board.
 *
 * Fitted against fixtures; the display pairing endpoint does not exist (GAP-008).
 *
 * It is deliberately inside the staff shell for now. In production this belongs on
 * an unauthenticated route of its own, rendered at display resolution with no nav
 * and no session — putting it behind the staff session would mean the board shows
 * nothing to the people it exists for. That split is a deliberate F1 decision to
 * revisit, and it is the reason this page is not linked from the rail yet.
 */
export default function DisplayPage() {
  return (
    <div className="px-6 py-8">
      <DisplayBoard entries={DISPLAY_BOARD_ENTRIES} title="Outpatient clinics" />
    </div>
  );
}
