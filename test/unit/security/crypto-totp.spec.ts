import { FieldEncryption } from '../../../src/common/security/crypto';
import {
  generateTotpCode,
  generateTotpSecret,
  RECOVERY_CODE_COUNT,
  totpUri,
  verifyTotp,
} from '../../../src/common/security/totp';

describe('FieldEncryption (AES-256-GCM at rest)', () => {
  const secret = '01234567890123456789012345678901';

  it('requires a key at least 32 characters', () => {
    expect(() => new FieldEncryption('short')).toThrow(/at least 32/i);
    expect(() => new FieldEncryption(secret)).not.toThrow();
  });

  it('round-trips plaintext and hides it in ciphertext', () => {
    const encryption = new FieldEncryption(secret);
    const encrypted = encryption.encrypt('S3Cr3T-MFA-key');
    expect(encrypted).not.toContain('S3Cr3T');
    const parts = encrypted.split('.');
    expect(parts).toHaveLength(3);
    const [iv, tag, data] = [parts[0]!, parts[1]!, parts[2]!];
    expect(iv.length).toBeGreaterThan(0);
    expect(tag.length).toBeGreaterThan(0);
    expect(data.length).toBeGreaterThan(0);
    expect(encryption.decrypt(encrypted)).toBe('S3Cr3T-MFA-key');
  });

  it('uses a fresh IV per encryption (no ciphertext equality)', () => {
    const encryption = new FieldEncryption(secret);
    expect(encryption.encrypt('same')).not.toBe(encryption.encrypt('same'));
  });

  it('throws on tampered ciphertext', () => {
    const encryption = new FieldEncryption(secret);
    const encrypted = encryption.encrypt('tamper-me');
    const tampered = encrypted.slice(0, -1) + (encrypted.endsWith('A') ? 'B' : 'A');
    expect(() => encryption.decrypt(tampered)).toThrow();
  });
});

describe('TOTP helpers', () => {
  it('issues a fixed set of 10 recovery codes by design', () => {
    expect(RECOVERY_CODE_COUNT).toBe(10);
  });

  it('generates a valid otpauth URI containing account + issuer', () => {
    const uri = totpUri('user@careos.test', 'careos', 'SECRET');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('careos:user%40careos.test');
    expect(uri).toContain('issuer=careos');
  });

  it('verifies a freshly generated code for the same secret', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it('rejects codes generated for a different secret', () => {
    const code = generateTotpCode('DIFFERENT-SECRET');
    expect(verifyTotp(code, 'ANOTHER-SECRET')).toBe(false);
  });
});
