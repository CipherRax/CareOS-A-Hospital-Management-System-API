import { notFound } from 'next/navigation';

import { EmergencyWorkspaceScreen } from '@/components/staff/emergency-workspace';

/**
 * /emergency/[id] — emergency workspace (F8 slice 3).
 *
 * `id` is the API's emergency visit id (a UUID in a real deployment;
 * EXAMPLE-scoped in the mock registry). A clearly malformed id fails closed with
 * `notFound()`, the same precedent as the other workspaces.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function EmergencyVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <EmergencyWorkspaceScreen id={id} />;
}
