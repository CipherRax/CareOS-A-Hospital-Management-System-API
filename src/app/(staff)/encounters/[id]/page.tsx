import { notFound } from 'next/navigation';

import { EncounterWorkspaceScreen } from '@/components/staff/encounter-workspace';

/**
 * /encounters/[id] — doctor workspace for one encounter (F4).
 *
 * `id` is the API's encounter id (a UUID in a real deployment; EXAMPLE-scoped in
 * the mock registry). A clearly malformed id fails closed with `notFound()` — a
 * path that can never be a record renders the platform missing page instead of a
 * spinner (the same precedent as the patient master page).
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function EncounterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <EncounterWorkspaceScreen id={id} />;
}