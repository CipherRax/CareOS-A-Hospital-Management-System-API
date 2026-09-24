import type { TxClient } from '../../../database/tx';

/** Counter keys for the org-scoped laboratory number series. */
export const LAB_COUNTER_KEYS = {
  order: 'lab_order_number',
  sample: 'lab_sample_number',
} as const;

export type LabNumberKey = keyof typeof LAB_COUNTER_KEYS;

const LAB_PREFIX: Record<LabNumberKey, string> = {
  order: 'LAB-ORD',
  sample: 'LAB-SMP',
};

/**
 * Formats a lab document number: `LAB-ORD-YYYY-NNNNNN` / `LAB-SMP-…`.
 * Same semantics as billing/document numbers — the year is the UTC year, the
 * sequence is a single org-scoped monotonic counter that never resets, so the
 * full string is unique even when the year prefix rolls over.
 */
export function formatLabNumber(
  key: LabNumberKey,
  seq: number | bigint,
  year = new Date().getUTCFullYear(),
): string {
  return `${LAB_PREFIX[key]}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Atomically advances an org-scoped lab counter and returns the next sequence
 * number. Concurrency model: `INSERT ... ON CONFLICT UPDATE` on the
 * `(organizationId, key)` unique index serializes concurrent creates at the
 * row level inside the transaction's RLS scope.
 */
export async function nextLabSequence(
  db: TxClient,
  organizationId: string,
  key: LabNumberKey,
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