import { notFound } from 'next/navigation';

import { InvoiceWorkspaceScreen } from '@/components/staff/invoice-workspace';

/**
 * /billing/[id] — invoice workspace (F7).
 *
 * `id` is the API's invoice id (a UUID in a real deployment; EXAMPLE-scoped in
 * the mock registry). A clearly malformed id fails closed with `notFound()`, the
 * same precedent as the laboratory and patient master pages.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <InvoiceWorkspaceScreen id={id} />;
}
