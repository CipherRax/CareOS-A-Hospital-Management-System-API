import type { TxClient } from '../../../database/tx';

/** Counter keys for the org-scoped operations number series (brief Phase 10). */
export const OPERATIONS_COUNTER_KEYS = {
  expense: 'expense_number',
} as const;

export type OperationsNumberKey = keyof typeof OPERATIONS_COUNTER_KEYS;

const PREFIX: Record<OperationsNumberKey, string> = {
  expense: 'EXP',
};

/**
 * Formats an operations document number: `EXP-YYYY-NNNNNN`. The year is the
 * UTC year the document was generated; the sequence is a single org-scoped
 * monotonic counter (same concurrency model as the billing counters).
 */
export function formatOperationsNumber(
  key: OperationsNumberKey,
  seq: number | bigint,
  year = new Date().getUTCFullYear(),
): string {
  const padded = String(seq).padStart(6, '0');
  return `${PREFIX[key]}-${year}-${padded}`;
}

/**
 * Atomically advances an org-scoped operations counter and returns the next
 * sequence number. Identical to the billing counter: an
 * `INSERT ... ON CONFLICT UPDATE` on `(organizationId, key)` serializes
 * concurrent creates at the row level inside the transaction's RLS scope.
 */
export async function nextOperationsSequence(
  db: TxClient,
  organizationId: string,
  key: OperationsNumberKey,
): Promise<bigint> {
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`
    INSERT INTO "counters" ("id", "organizationId", "key", "value", "updatedAt")
    VALUES (${`cnt-${organizationId}-${OPERATIONS_COUNTER_KEYS[key]}`}, ${organizationId}, ${OPERATIONS_COUNTER_KEYS[key]}, 1, NOW())
    ON CONFLICT ("organizationId", "key")
    DO UPDATE SET "value" = "counters"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1n;
}