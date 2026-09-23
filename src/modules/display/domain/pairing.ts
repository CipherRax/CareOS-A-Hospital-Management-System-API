import {
  generateDeviceToken,
  generateSecretCode,
  hashSecret,
  normalizePairingCode,
} from '../../../common/security/device-secret';

/**
 * Display-device pairing (brief §5.16).
 *
 *  - Pairing codes are short, human-typable and unambiguous (no 0/O/1/I).
 *  - Codes and device tokens are only ever stored as SHA-256 hashes.
 *  - A pairing code is one-time and expires after PAIRING_CODE_TTL_MS (10 min).
 */

export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

export { generateDeviceToken, hashSecret, normalizePairingCode };

/** Cryptographically-random N-character pairing code from the unambiguous alphabet. */
export function generatePairingCode(length: number = PAIRING_CODE_LENGTH): string {
  return generateSecretCode(length, PAIRING_CODE_ALPHABET);
}