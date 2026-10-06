import { notFound } from 'next/navigation';

import { PatientHeader } from '@/components/clinical/patient-header';
import { Timeline } from '@/components/clinical/timeline';
import { PATIENT } from '@/mocks/fixtures/patient';

/**
 * /triage/[reference] — one patient's record.
 *
 * Fitted against fixtures. The record endpoint does not exist (GAP-011), so the
 * row links in the queue currently 404 in a real deployment; this page exists to
 * review the banner and the timeline, which is where the design risk is.
 *
 * `notFound()` for any other reference rather than rendering the same fixture for
 * every patient — a screen that shows EXAMPLE Achieng's record under any reference
 * would be actively dangerous once real data arrives.
 */
export default async function PatientRecordPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  if (reference !== PATIENT.reference) {
    notFound();
  }

  return (
    <div className="flex flex-col">
      <PatientHeader patient={PATIENT} />
      <div className="flex flex-col gap-4 px-6 py-6">
        <div className="max-w-2xl">
          <h2 className="mb-3 text-heading-xs font-semibold text-primary">Clinical timeline</h2>
          {/* The facility's zone, so a reader can tell why two entries are the
              distance apart they appear to be. */}
          <Timeline events={PATIENT.events} timeZone="Africa/Nairobi" />
        </div>
      </div>
    </div>
  );
}
