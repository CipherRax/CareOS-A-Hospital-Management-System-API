import type { TxClient } from '../../../database/tx';

/** Counter key for the org-scoped patient-number series. */
export const PATIENT_NUMBER_COUNTER_KEY = 'patient_number';

/**
 * Formats a patient number: `PAT-YYYY-NNNNNN`. The year is the registration
 * year of the FIRST registration (seq 1), so a single sequence whose prefix
 * stays stable for the org's lifecycle keeps numbers sortable and human-scannable.
 */
export function formatPatientNumber(seq: number | bigint, year = new Date().getUTCFullYear()): string {
  const padded = String(seq).padStart(6, '0');
  return `PAT-${year}-${padded}`;
}

/**
 * Atomically advances the org-scoped patient-number counter and returns the
 * next sequence number. Concurrency-safe: an `INSERT ... ON CONFLICT UPDATE`
 * on the `(organizationId, key)` unique index serializes concurrent creates at
 * the row level, and the transaction's RLS scope pins the write to the org.
 * The number series is deliberately never derived from table ids.
 */
export async function nextPatientSequence(
  db: TxClient,
  organizationId: string,
): Promise<bigint> {
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`
    INSERT INTO "counters" ("id", "organizationId", "key", "value", "updatedAt")
    VALUES (${`cnt-${organizationId}-${PATIENT_NUMBER_COUNTER_KEY}`}, ${organizationId}, ${PATIENT_NUMBER_COUNTER_KEY}, 1, NOW())
    ON CONFLICT ("organizationId", "key")
    DO UPDATE SET "value" = "counters"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1n;
}