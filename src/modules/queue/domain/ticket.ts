import type { TxClient } from '../../../database/tx';

/**
 * Per-(branch, department, business-day) display ticket numbers. The counter
 * table's (organizationId, key) unique index serializes concurrent draws at the
 * row level (same pattern as the patient-number series).
 */

export function queueCounterKey(
  branchId: string,
  departmentId: string,
  queueDate: Date,
): string {
  return `queue:${branchId}:${departmentId}:${queueDate.toISOString().slice(0, 10)}`;
}

/** Formats a ticket like `A034` from a prefix and a sequence number. */
export function formatTicket(prefix: string, seq: number | bigint): string {
  const padded = String(seq).padStart(3, '0');
  return `${prefix}${padded}`;
}

/**
 * Deterministic one-letter prefix for a department (first letter A–Z; falls
 * back to `Q`). Prefix collisions across departments are harmless — the
 * per-day sequence is unique within (branch, department).
 */
export function ticketPrefixFor(departmentName: string): string {
  const letter = departmentName.trim().toUpperCase().charCodeAt(0);
  if (letter >= 65 && letter <= 90) return String.fromCharCode(letter);
  return 'Q';
}

export async function nextQueueSequence(
  db: TxClient,
  organizationId: string,
  branchId: string,
  departmentId: string,
  queueDate: Date,
): Promise<bigint> {
  const key = queueCounterKey(branchId, departmentId, queueDate);
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`
    INSERT INTO "counters" ("id", "organizationId", "key", "value", "updatedAt")
    VALUES (${`cnt-${organizationId}-${key}`}, ${organizationId}, ${key}, 1, NOW())
    ON CONFLICT ("organizationId", "key")
    DO UPDATE SET "value" = "counters"."value" + 1, "updatedAt" = NOW()
    RETURNING "value"
  `;
  return rows[0]?.value ?? 1n;
}