import { createHash, randomBytes } from 'node:crypto';

/**
 * Shared helpers for display-device pairing secrets. Kept in common so both
 * the DeviceAuthGuard (src/common) and the display module can use them without
 * violating the boundary rules (common must not import modules).
 */

/** SHA-256 hex digest — pairing codes and device tokens are stored as digests. */
export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Opaque bearer token for a paired display: `<organizationId>.<32 bytes base64url>`.
 * The org prefix lets the device guard scope its lookup before touching tenant
 * tables (RLS-safe); the random suffix is the actual secret and the whole
 * string is only ever stored as a SHA-256 digest.
 */
export function generateDeviceToken(organizationId: string): string {
  return `${organizationId}.${randomBytes(32).toString('base64url')}`;
}

/** Strips whitespace/dashes and upper-cases a pairing code for comparison. */
export function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function generateSecretCode(length: number, alphabet: string): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}