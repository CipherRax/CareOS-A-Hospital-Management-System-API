import { notFound } from 'next/navigation';

import { StaffWorkspaceScreen } from '@/components/staff/staff-workspace';

/**
 * /staff/[id] — staff workspace (F9 administration).
 *
 * `id` is the API's staff-profile id (a UUID in a real deployment; EXAMPLE-scoped
 * in the mock registry). A clearly malformed id fails closed with `notFound()`,
 * the same precedent as the other workspaces.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <StaffWorkspaceScreen id={id} />;
}
