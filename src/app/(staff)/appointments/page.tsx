import { AppointmentDeskScreen } from '@/components/staff/appointment-desk';

/**
 * /appointments — reception appointment desk (F3).
 *
 * The day book reads `GET /appointments`, whose 200 the export mis-types as the
 * request DTO (GAP-017), so rows are validated structurally. Actions follow the
 * API's own transition graph; booking searches slots through `/schedules/slots`,
 * and the waitlist is the department `GET /appointments/waitlist/entries`.
 */
export default function AppointmentsPage() {
  return <AppointmentDeskScreen />;
}
