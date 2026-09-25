import type { TxClient } from '../../../database/tx';

/** Counter key for the org-scoped emergency visit number series. */
export const EMERGENCY_COUNTER_KEYS = {
  visit: 'emergency_visit_number',
} as const;

export type EmergencyNumberKey = keyof typeof EMERGENCY_COUNTER_KEYS;

const EMERGENCY_PREFIX: Record<EmergencyNumberKey, string> = {
  visit: 'ER',
};

/**
 * Formats an emergency visit number: `ER-YYYY-NNNNNN`. Year is the UTC year;
 * the sequence is a single org-scoped monotonic counter (unique across years).
 */
export function formatEmergencyNumber(
  key: EmergencyNumberKey,
  seq: number | bigint,
  year = new Date().getUTCFullYear(),
): string {
  return `${EMERGENCY_PREFIX[key]}-${year}-${String(seq).padStart(6, '0')}`;
}

/** Atomically advances the org-scoped emergency visit counter (see lab-number). */
export async function nextEmergencySequence(
  db: TxClient,
  organizationId: string,
  key: EmergencyNumberKey,
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