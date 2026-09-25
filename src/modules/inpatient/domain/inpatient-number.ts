import type { TxClient } from '../../../database/tx';

/** Counter keys for the org-scoped inpatient number series. */
export const INPATIENT_COUNTER_KEYS = {
  admission: 'admission_number',
} as const;

export type InpatientNumberKey = keyof typeof INPATIENT_COUNTER_KEYS;

const INPATIENT_PREFIX: Record<InpatientNumberKey, string> = {
  admission: 'ADM',
};

/**
 * Formats an inpatient document number: `ADM-YYYY-NNNNNN`. Same semantics as
 * lab/billing numbers — the year is the UTC year, the sequence is a single
 * org-scoped monotonic counter that never resets, so the full string is unique
 * even when the year prefix rolls over.
 */
export function formatInpatientNumber(
  key: InpatientNumberKey,
  seq: number | bigint,
  year = new Date().getUTCFullYear(),
): string {
  return `${INPATIENT_PREFIX[key]}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Atomically advances an org-scoped admission counter and returns the next
 * sequence number. `INSERT ... ON CONFLICT UPDATE` on `(organizationId, key)`
 * serializes concurrent creates at the row level inside the transaction.
 */
export async function nextInpatientSequence(
  db: TxClient,
  organizationId: string,
  key: InpatientNumberKey,
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