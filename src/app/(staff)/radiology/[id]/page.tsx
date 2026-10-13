import { notFound } from 'next/navigation';

import { RadiologyOrderWorkspaceScreen } from '@/components/staff/radiology-order-workspace';

/**
 * /radiology/[id] — imaging workspace for one order (F5).
 *
 * `id` is the API's radiology order id (a UUID in a real deployment;
 * EXAMPLE-scoped in the mock registry). A clearly malformed id fails closed with
 * `notFound()` — a path that can never be a record renders the platform missing
 * page instead of a spinner (the same precedent as the patient master page).
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function RadiologyOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <RadiologyOrderWorkspaceScreen id={id} />;
}
