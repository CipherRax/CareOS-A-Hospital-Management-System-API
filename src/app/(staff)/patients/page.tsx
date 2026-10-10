import { PatientSearchScreen } from '@/components/staff/patient-search';

/**
 * /patients — reception patient search.
 *
 * Server component rendering a client screen; the search is interactive so it
 * lives client-side, but the route stays a plain page so a later server-side gate
 * (facility scoping) is a local change.
 *
 * Data comes from the patient registry fixtures, marked EXAMPLE (the live search
 * endpoint is the same one the screens use; there is no separate `/search` path).
 */
export default function PatientsPage() {
  return <PatientSearchScreen />;
}
