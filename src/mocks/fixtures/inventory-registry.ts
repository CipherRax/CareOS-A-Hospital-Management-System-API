/**
 * F6 pharmacy inventory fixtures (dispensing worklist).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the
 * production-build e2e report the same branch stock. Medication ids line up
 * with `medications-registry.ts`; the branch id lines up with
 * `prescriptions-registry.ts` (dispensing happens at the prescription's branch).
 */

export { PRESCRIPTION_BRANCH_ID as INVENTORY_BRANCH_ID } from '@/mocks/fixtures/prescriptions-registry';

export interface StockOnHandFixture {
  readonly medicationId: string;
  readonly quantity: number;
}

/**
 * Opening stock for the example branch. Deliberately uneven: a controlled drug
 * and a supply sit low so the dispense composer has to surface a shortfall, and
 * the rest comfortably cover their outstanding prescriptions.
 */
export const STOCK_ON_HAND: readonly StockOnHandFixture[] = [
  { medicationId: 'med_example_7101', quantity: 30 },
  { medicationId: 'med_example_7102', quantity: 40 },
  { medicationId: 'med_example_7103', quantity: 12 },
  { medicationId: 'med_example_7104', quantity: 60 },
  { medicationId: 'med_example_7105', quantity: 4 },
  { medicationId: 'med_example_7106', quantity: 8 },
];
