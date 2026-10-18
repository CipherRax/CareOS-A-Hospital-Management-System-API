import { notFound } from 'next/navigation';

import { PurchaseOrderWorkspaceScreen } from '@/components/staff/purchase-order-workspace';

/**
 * /pharmacy/purchase-orders/[id] — one purchase order and its lifecycle moves (F6).
 *
 * `id` is the API's purchase-order id (a UUID in a real deployment; EXAMPLE-scoped
 * in the mock registry). A clearly malformed id fails closed with `notFound()`,
 * the same precedent as the billing, laboratory and patient master pages.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_PATTERN.test(id)) {
    notFound();
  }

  return <PurchaseOrderWorkspaceScreen id={id} />;
}
