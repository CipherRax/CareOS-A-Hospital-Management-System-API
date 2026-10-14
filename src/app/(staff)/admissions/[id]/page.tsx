import { notFound } from 'next/navigation';

import { AdmissionWorkspaceScreen } from '@/components/staff/admission-workspace';

/**
 * /admissions/[id] — admission workspace (F8 slice 2).
 *
 * `id` is the API's admission id (a UUID in a real deployment; EXAMPLE-scoped in
 * the mock registry). A clearly malformed id fails closed with `notFound()`, the
 * same precedent as the invoice, claim and ward workspaces.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function AdmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <AdmissionWorkspaceScreen id={id} />;
}
