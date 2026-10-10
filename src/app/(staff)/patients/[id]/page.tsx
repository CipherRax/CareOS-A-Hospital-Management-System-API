import { notFound } from 'next/navigation';

import { PatientMasterScreen } from '@/components/staff/patient-master';

/**
 * /patients/[id] — a patient's master record.
 *
 * `id` is the API's patient id (a UUID in a real deployment; the mock registry
 * uses EXAMPLE-scoped ids). The master/timeline/access-log endpoints key on it,
 * not on the display patient number (GAP-015).
 *
 * A clearly malformed id fails closed with `notFound()` rather than reaching for
 * the API, so a path that can never be a record renders the platform's missing
 * page instead of a spinner (the same precedent as the triage record page).
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <PatientMasterScreen id={id} />;
}
