import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Counter key for the org-scoped emergency request reference series. */
export const EMERGENCY_REQUEST_COUNTER_KEY = 'emergency_request_number';

/**
 * Formats an emergency request reference: `EMR-YYYY-NNNNNN`. Year is the UTC
 * year; the sequence is a single org-scoped monotonic counter (unique across
 * years, like the ER visit numbers).
 */
export function formatEmergencyRequestReference(seq: number | bigint): string {
  return `EMR-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
}

/**
 * Caller tracking token. Fresh random bytes per request; only the SHA-256 hex
 * digest is persisted (ADR-040 — outbox/job payloads and the DB hold no
 * plaintext token), so the token acts as a bearer capability the caller keeps.
 */
export function generateTrackingToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/** Normalized searchable phone derivative (ADR-041): digits and leading + only. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/** Parses the policy `levelSeconds` JSON into a number[] (empty if malformed). */
export function parseLevelSeconds(value: Prisma.JsonValue | undefined): number[] {
  if (Array.isArray(value)) {
    const nums = value
      .map((n) => (typeof n === 'number' ? n : Number.parseFloat(String(n))))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length > 0) return nums;
  }
  // Default: three levels (2m, 5m, 15m).
  return [120, 300, 900];
}

/**
 * Sub-second values are treated as milliseconds so tests can drive real
 * delayed escalation fast; >= 1 is treated as seconds (ADR-040 SLA units).
 */
export function levelDelayMs(seconds: number): number {
  const ms = seconds * 1000;
  return Math.max(1, Math.round(ms));
}

/** Escalation depth of a policy (how many levels its SLA windows define). */
export function escalationDepth(levelSeconds: Prisma.JsonValue | undefined): number {
  return parseLevelSeconds(levelSeconds).length;
}

/**
 * Caller-facing guidance derived from the request read model. ADR-040: only a
 * staff-set RESPONDING implies help is coming; everything short of that while
 * the final escalation level is reached is CALL_NOW.
 */
export function callerAction(request: {
  status: string;
  escalationLevel: number;
  acknowledgedAt: Date | null;
  respondedAt: Date | null;
}): 'WAIT' | 'CALL_NOW' | 'HELP_ON_WAY' {
  if (request.respondedAt) return 'HELP_ON_WAY';
  if (request.status === 'CANCELLED' || request.status === 'CLOSED') return 'WAIT';
  if (request.acknowledgedAt) return 'WAIT';
  if (request.escalationLevel > 0) return 'CALL_NOW';
  return 'WAIT';
}