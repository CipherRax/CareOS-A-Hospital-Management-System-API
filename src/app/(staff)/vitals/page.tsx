import { VitalsConsoleScreen } from '@/components/staff/vitals-console';

/**
 * /vitals — nursing vitals console (F3).
 *
 * The chart is `GET /vitals?patientId=`, whose 200 the export mis-types as the
 * request DTO and whose query is unmodelled (GAP-017), so rows are validated
 * structurally. Recording and correcting both write append-only records; a
 * correction never edits history.
 */
export default function VitalsPage() {
  return <VitalsConsoleScreen />;
}
