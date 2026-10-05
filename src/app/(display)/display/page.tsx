import { DisplayBoard } from '@/components/staff/display-board';
import { DISPLAY_BOARD_ENTRIES } from '@/mocks/fixtures/patient';

/**
 * /display — waiting-room board.
 *
 * Fitted against fixtures; the display pairing endpoint does not exist (GAP-008).
 *
 * Unauthenticated by design, in its own route group, outside the staff shell. Not
 * linked from the nav rail: a clinician has no use for it, and a link is an
 * invitation to wire in data this screen must never receive.
 */
export default function DisplayPage() {
  return (
    <div className="px-6 py-8">
      <DisplayBoard entries={DISPLAY_BOARD_ENTRIES} title="Outpatient clinics" />
    </div>
  );
}
