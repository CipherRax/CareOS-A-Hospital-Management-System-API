/**
 * Pure refresh-token rotation semantics. A refresh token is either the current
 * one for its family (→ rotate to a new token) or a previously-rotated/revoked
 * one (→ the family has been reused; revoke everything and refuse).
 */
export type RotationVerdict = 'current' | 'reuse' | 'unknown';

export interface RefreshRecordState {
  usedAt?: Date | null;
  revokedAt?: Date | null;
  expiresAt: Date;
}

export function classifyRefreshToken(
  record: RefreshRecordState,
  now: Date,
): RotationVerdict {
  if (record.revokedAt !== undefined && record.revokedAt !== null) return 'reuse';
  if (record.usedAt !== undefined && record.usedAt !== null) return 'reuse';
  if (record.expiresAt.getTime() <= now.getTime()) return 'unknown';
  return 'current';
}

export interface SessionState {
  revokedAt?: Date | null;
  suspendedAt?: Date | null;
  expiresAt: Date;
}

export type SessionVerdict = 'valid' | 'revoked' | 'expired';

export function classifySession(session: SessionState, now: Date): SessionVerdict {
  if (session.revokedAt !== undefined && session.revokedAt !== null) return 'revoked';
  if (session.suspendedAt !== undefined && session.suspendedAt !== null) return 'revoked';
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
