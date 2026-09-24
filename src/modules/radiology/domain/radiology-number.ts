import type { TxClient } from '../../../database/tx';

/** Counter key for the org-scoped radiology order number series. */
export const RADIOLOGY_COUNTER_KEY = 'radiology_order_number';

/**
 * Formats a radiology document number: `RAD-YYYY-NNNNNN`. Same semantics as
 * billing/lab numbers — the year is the UTC year, the sequence is a single
 * org-scoped monotonic counter that never resets.
 */
export function formatRadiologyNumber(
  seq: number | bigint,
  year = new Date().getUTCFullYear(),
): string {
  return `RAD-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Atomically advances the org-scoped radiology counter and returns the next
 * sequence number. `INSERT ... ON CONFLICT UPDATE` on the
 * `(organizationId, key)` unique index serializes concurrent creates.
 */
export async function nextRadiologySequence(
  db: TxClient,
  organizationId: string,
  key: string = RADIOLOGY_COUNTER_KEY,
): Promise<bigint> {
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`
    INSERT INTO "counters" ("id", "organizationId", "key", "value", "updatedAt")
    VALUES (${`cnt-${organizationId}-${key}`}, ${organizationId}, ${key}, 1, NOW())
    ON CONFLICT ("organizationId", "key")
    DO UPDATE SET "value" = "counters"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1n;
}