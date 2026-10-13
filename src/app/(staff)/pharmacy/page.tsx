import { PharmacyWorklistScreen } from '@/components/staff/pharmacy-worklist';

/**
 * /pharmacy — pharmacy dispense worklist (F6).
 *
 * The prescription list is read through the prescriptions client; the branch
 * stock read and the dispense write are GAP-020 (the export leaves the on-hand
 * query unmodelled and types the 201 as `InventoryResponseDto` while the service
 * answers a bare `{ prescriptionStatus, dispensedLines }`), so both are
 * validated structurally in `src/lib/data/inventory.ts`.
 */
export default function PharmacyPage() {
  return <PharmacyWorklistScreen />;
}
