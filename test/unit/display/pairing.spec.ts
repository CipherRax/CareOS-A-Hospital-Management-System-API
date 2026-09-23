import { createHash } from 'node:crypto';
import {
  generateDeviceToken,
  hashSecret,
  normalizePairingCode,
} from '../../../src/common/security/device-secret';
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  generatePairingCode,
} from '../../../src/modules/display/domain/pairing';

describe('pairing', () => {
  it('generates one-time codes from the unambiguous alphabet', () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    for (const ch of code.split('')) {
      expect(PAIRING_CODE_ALPHABET).toContain(ch);
    }
  });

  it('excludes confusable glyphs 0/O and 1/I from the alphabet', () => {
    expect(PAIRING_CODE_ALPHABET).not.toContain('0');
    expect(PAIRING_CODE_ALPHABET).not.toContain('O');
    expect(PAIRING_CODE_ALPHABET).not.toContain('1');
    expect(PAIRING_CODE_ALPHABET).not.toContain('I');
  });

  it('PAIRING_CODE_TTL_MS is ten minutes', () => {
    expect(PAIRING_CODE_TTL_MS).toBe(10 * 60_000);
  });

  describe('normalizePairingCode', () => {
    it('strips whitespace and dashes and upper-cases', () => {
      expect(normalizePairingCode(' ab-cd-ef ')).toBe('ABCDEF');
      expect(normalizePairingCode('abc123')).toBe('ABC123');
    });
  });

  describe('hashing', () => {
    it('hashes to a stable sha256 hex digest', () => {
      const value = 'ABC123';
      expect(hashSecret(value)).toBe(createHash('sha256').update(value).digest('hex'));
    });

    it('never stores or returns the raw secret', () => {
      const raw = generateDeviceToken('org-1');
      expect(raw).toContain('org-1.');
      expect(hashSecret(raw)).not.toContain(raw);
    });
  });

  describe('generateDeviceToken', () => {
    it('embeds the organization prefix and a long random suffix', () => {
      const a = generateDeviceToken('org-1');
      const b = generateDeviceToken('org-1');
      expect(a.startsWith('org-1.')).toBe(true);
      expect(a).not.toBe(b);
      const suffix = a.split('.')[1]!;
      expect(Buffer.from(suffix, 'base64url').length).toBe(32);
    });
  });
});