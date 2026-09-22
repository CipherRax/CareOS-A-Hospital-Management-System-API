import { authenticator } from 'otplib';

export { authenticator as totp };

/** Number of recovery codes issued at MFA enrolment. */
export const RECOVERY_CODE_COUNT = 10;

/** Generates a new base32 TOTP shared secret (160-bit). */
export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

/** Standard otpauth:// URI for QR display. */
export function totpUri(accountName: string, issuer: string, secret: string): string {
  return authenticator.keyuri(accountName, issuer, secret);
}

/** Verifies a 6-digit code against the shared secret (±1 time window). */
export function verifyTotp(token: string, secret: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  return authenticator.check(token, secret);
}

/** Generates the current code for a secret (tests + recovery debug only). */
export function generateTotpCode(secret: string): string {
  return authenticator.generate(secret);
}
