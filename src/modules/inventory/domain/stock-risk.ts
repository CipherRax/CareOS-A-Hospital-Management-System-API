/**
 * Inventory analytics (brief Phase 5 §7.4). Pure functions over the append-only
 * ledger. No `reorderLevel`/`safetyStock`/`leadTimeDays` columns exist on the
 * catalog — thresholds are computed estimates derived from actual consumption,
 * surfaced as labelled advisories (never hard alerts that block operations).
 */

export interface LedgerLine {
  operation: 'RECEIVED' | 'DISPENSED' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT' | 'RETURN' | 'WASTAGE';
  quantity: number;
  occurredAt: Date;
}

/** Signed inventory movement for a unit of a medication (ledger meaning). */
export function ledgerSign(operation: LedgerLine['operation']): number {
  switch (operation) {
    case 'RECEIVED':
    case 'TRANSFER_IN':
    case 'RETURN':
      return 1;
    case 'ADJUSTMENT':
      return Math.sign(1); // signed by the caller (count-based adjustments)
    case 'DISPENSED':
    case 'TRANSFER_OUT':
    case 'WASTAGE':
      return -1;
  }
}

/** Net on-hand for one medication from its ledger history (reconstruction). */
export function computeOnHand(lines: readonly LedgerLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Total consumption (positive number) over the given window, backwards from now. */
export function consumptionSince(lines: readonly LedgerLine[], days: number): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return lines
    .filter((l) => l.occurredAt.getTime() >= cutoff)
    .reduce((sum, l) => {
      const signed = ledgerSign(l.operation) >= 0 ? 0 : -l.quantity;
      return sum + Math.max(0, signed);
    }, 0);
}

/** Average daily usage over the window (0 when nothing was consumed). */
export function avgDailyUsage(lines: readonly LedgerLine[], windowDays: number): number {
  return consumptionSince(lines, windowDays) / windowDays;
}

export interface StockRiskInput {
  onHand: number;
  /** Average daily usage (units/day) — pass 0 when there is no consumption history. */
  usagePerDay: number;
  /** Default target days of stock to keep on hand when no threshold is stored. */
  targetDays: number;
  /** Days until each batch expires (non-null only when it actually expires). */
  daysToExpiry: ReadonlyArray<number | null>;
}

export type StockRiskTier =
  | { label: 'OK' }
  | { label: 'LOW_STOCK'; daysOfCover: number | null }
  | { label: 'REORDER_RISK'; daysOfCover: number }
  | { label: 'EXPIRY_RISK'; closestExpiryDays: number };

export function assessStockRisk(input: StockRiskInput): StockRiskTier {
  // Expiry risk wins: stock that will rot is a bigger problem than restock cadence.
  const expiring = input.daysToExpiry.filter((d): d is number => d !== null && d >= 0);
  const closest = expiring.length > 0 ? Math.min(...expiring) : null;
  if (closest !== null && closest <= 90) {
    return { label: 'EXPIRY_RISK', closestExpiryDays: closest };
  }

  if (input.usagePerDay <= 0) {
    // No usage history: only flag a definitive low-stock position.
    return input.onHand <= input.targetDays ? { label: 'LOW_STOCK', daysOfCover: null } : { label: 'OK' };
  }

  const daysOfCover = input.onHand / input.usagePerDay;
  if (daysOfCover <= input.targetDays / 2) return { label: 'LOW_STOCK', daysOfCover };
  if (daysOfCover <= input.targetDays) return { label: 'REORDER_RISK', daysOfCover };
  return { label: 'OK' };
}