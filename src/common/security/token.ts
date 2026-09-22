import { createHash, randomBytes } from 'node:crypto';

/** Generates a cryptographically-random opaque token (hex). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** SHA-256 hex digest — the only form in which random tokens are persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Generates a pre-hashed opaque token pair: value (returned once) and digest (stored). */
export function generateHashedToken(bytes = 32): { value: string; digest: string } {
  const value = generateToken(bytes);
  return { value, digest: hashToken(value) };
}
