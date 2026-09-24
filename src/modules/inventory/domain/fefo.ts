import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * FEFO allocation (first-expiry-first-out, brief Phase 5 §7.4). Given a list of
 * batches for one medication at one branch, allocate `requested` units taking
 * from the soonest-expiring eligible batch first. Expiry-null batches (no known
 * expiry) sort last — freshest stock is always dispensed last.
 *
 * Error semantics (matches the API contract):
 *  - all stock across branches < requested      → INSUFFICIENT_STOCK
 *  - enough total stock but NOT enough eligible → MEDICATION_EXPIRED
 *    (eligible = not expired; quarantined batches are never eligible)
 */
export interface FefoBatch {
  id: string;
  batchNumber: string;
  onHand: number;
  expiryDate: Date | null;
  status: 'AVAILABLE' | 'QUARANTINED' | 'EXPIRED';
}

export interface FefoAllocation {
  batchId: string;
  batchNumber: string;
  quantity: number;
}

export function allocateFefo(batches: readonly FefoBatch[], requested: number): FefoAllocation[] {
  if (requested <= 0) return [];

  const totalOnHand = batches.reduce((sum, b) => sum + b.onHand, 0);
  if (totalOnHand < requested) {
    throw new AppError({
      code: ErrorCodes.INSUFFICIENT_STOCK,
      message: `Insufficient stock: ${totalOnHand} available, ${requested} requested.`,
      silent: true,
    });
  }

  // FSFE sorts quarantined batches as ineligible; EXPIRED batches are
  // ineligible as well (they should be quarantined by the daily job).
  const eligible = batches
    .filter((b) => b.onHand > 0 && b.status === 'AVAILABLE' && !isExpired(b))
    .sort((a, b) => compareExpiry(a.expiryDate, b.expiryDate));

  const availableEligible = eligible.reduce((sum, b) => sum + b.onHand, 0);
  if (availableEligible < requested) {
    throw new AppError({
      code: ErrorCodes.MEDICATION_EXPIRED,
      message: `Only ${availableEligible} units unexpired, ${requested} requested.`,
      silent: true,
    });
  }

  const allocations: FefoAllocation[] = [];
  let remaining = requested;
  for (const batch of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(batch.onHand, remaining);
    allocations.push({ batchId: batch.id, batchNumber: batch.batchNumber, quantity: take });
    remaining -= take;
  }
  return allocations;
}

function isExpired(batch: FefoBatch): boolean {
  if (!batch.expiryDate) return false;
  return batch.expiryDate.getTime() <= Date.now();
}

function compareExpiry(a: Date | null, b: Date | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // unknown expiry sorts last
  if (b === null) return -1;
  return a.getTime() - b.getTime();
}