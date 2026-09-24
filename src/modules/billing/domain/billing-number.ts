import type { TxClient } from '../../../database/tx';

/** Counter keys for the org-scoped billing number series. */
export const BILLING_COUNTER_KEYS = {
  invoice: 'invoice_number',
  receipt: 'receipt_number',
  claim: 'claim_number',
} as const;

export type BillingNumberKey = keyof typeof BILLING_COUNTER_KEYS;

const PREFIX: Record<BillingNumberKey, string> = {
  invoice: 'INV',
  receipt: 'RCT',
  claim: 'CLM',
};

/**
 * Formats a billing document number: `INV-YYYY-NNNNNN` / `RCT-…` / `CLM-…`.
 * The year is the UTC year in which the document was generated. The sequence
 * is a single org-scoped monotonic counter, so the full string is unique even
 * though the year prefix rolls over (the counter never resets).
 */
export function formatBillingNumber(
  key: BillingNumberKey,
  seq: number | bigint,
  year = new Date().getUTCFullYear(),
): string {
  const padded = String(seq).padStart(6, '0');
  return `${PREFIX[key]}-${year}-${padded}`;
}

/**
 * Atomically advances an org-scoped billing counter and returns the next
 * sequence number. Same concurrency model as the patient-number counter: an
 * `INSERT ... ON CONFLICT UPDATE` on the `(organizationId, key)` unique index
 * serializes concurrent creates at the row level inside the transaction's RLS
 * scope. Series are deliberately never derived from table ids.
 */
export async function nextBillingSequence(
  db: TxClient,
  organizationId: string,
  key: BillingNumberKey,
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