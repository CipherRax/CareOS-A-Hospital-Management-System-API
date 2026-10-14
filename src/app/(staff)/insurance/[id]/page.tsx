import { notFound } from 'next/navigation';

import { ClaimWorkspaceScreen } from '@/components/staff/claim-workspace';

/**
 * /insurance/[id] — claim workspace (F7).
 *
 * `id` is the API's claim id (a UUID in a real deployment; EXAMPLE-scoped in the
 * mock registry). A clearly malformed id fails closed with `notFound()`, the same
 * precedent as the invoice and patient master pages.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <ClaimWorkspaceScreen id={id} />;
}
