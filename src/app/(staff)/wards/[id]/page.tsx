import { notFound } from 'next/navigation';

import { WardWorkspaceScreen } from '@/components/staff/ward-workspace';

/**
 * /wards/[id] — ward workspace (F8).
 *
 * `id` is the API's ward id (a UUID in a real deployment; EXAMPLE-scoped in the
 * mock registry). A clearly malformed id fails closed with `notFound()`, the same
 * precedent as the invoice and claim workspaces.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function WardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <WardWorkspaceScreen id={id} />;
}
