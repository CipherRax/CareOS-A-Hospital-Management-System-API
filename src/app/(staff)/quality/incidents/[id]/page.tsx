import { notFound } from 'next/navigation';

import { IncidentWorkspaceScreen } from '@/components/staff/incident-workspace';

/**
 * /quality/incidents/[id] — one incident and its lifecycle, from investigation
 * through an action plan to resolution and closure (brief Phase 10).
 *
 * `id` is the API's incident id (a UUID in a real deployment; EXAMPLE-scoped in
 * the mock registry). A clearly malformed id fails closed with `notFound()`, the
 * same precedent as the billing, laboratory, pharmacy and patient master pages.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <IncidentWorkspaceScreen id={id} />;
}
