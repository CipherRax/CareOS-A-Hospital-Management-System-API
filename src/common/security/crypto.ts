import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;

/**
 * AES-256-GCM encryption for values that must be protected at rest (currently
 * MFA shared secrets). The key is derived from KEY_ENCRYPTION_SECRET via
 * SHA-256. Format: `iv.tag.ciphertext` (base64url, no padding).
 */
export class FieldEncryption {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (typeof secret !== 'string' || secret.length < 32) {
      throw new Error('KEY_ENCRYPTION_SECRET must be at least 32 characters');
    }
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ctB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !ctB64) {
      throw new Error('Malformed encrypted value');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
