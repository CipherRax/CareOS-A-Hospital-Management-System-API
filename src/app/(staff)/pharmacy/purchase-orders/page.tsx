import { PharmacyPurchaseOrdersScreen } from '@/components/staff/pharmacy-purchase-orders';

/**
 * /pharmacy/purchase-orders — the procurement read (F6).
 *
 * `GET /purchase-orders` fastens the request DTO onto its 200 while the service
 * answers `pageOf(...)` of serialized orders (GAP-020), so the rows — and the
 * supplier directory read that names each one — are validated structurally in
 * `src/lib/data/purchase-orders.ts`.
 */
export default function PharmacyPurchaseOrdersPage() {
  return <PharmacyPurchaseOrdersScreen />;
}
