import { notFound } from 'next/navigation';

import { ComplaintWorkspaceScreen } from '@/components/staff/complaint-workspace';

/**
 * /quality/complaints/[id] — one complaint and its lifecycle, from assignment
 * through resolution and closure (brief Phase 10).
 *
 * `id` is the API's complaint id (a UUID in a real deployment; EXAMPLE-scoped in
 * the mock registry). A clearly malformed id fails closed with `notFound()`, the
 * same precedent as the billing, laboratory, pharmacy and patient master pages.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function ComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <ComplaintWorkspaceScreen id={id} />;
}
