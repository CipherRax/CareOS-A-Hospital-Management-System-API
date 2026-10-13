import { PharmacyStockScreen } from '@/components/staff/pharmacy-stock';

/**
 * /pharmacy/stock — pharmacy stock control (F6 slice 2).
 *
 * The on-hand and alert reads are both GAP-020 raw reads (`{ onHand }` /
 * `{ alerts }`), and receiving answers a bare `{ batches }` while the export
 * types the 201 as `InventoryResponseDto`, so all three are validated
 * structurally in `src/lib/data/inventory.ts`.
 */
export default function PharmacyStockPage() {
  return <PharmacyStockScreen />;
}
