import { randomFillSync } from 'node:crypto';

/**
 * UUIDv7 — time-ordered (RFC 9562). Primary keys, generated in application
 * code so Prisma never needs to assign ids. Snapshot timestamp in the low 48
 * bits of bit-position 0..47, version 7, RFC4122 variant. A per-process
 * monotonic 12-bit `rand_a` counter (RFC 9562 §4.3) guarantees ordering for
 * ids minted within the same millisecond.
 */
let lastMs = 0;
let seq = 0;

export function newId(): string {
  let ts = Date.now();
  if (ts === lastMs) {
    seq = (seq + 1) & 0xfff;
    if (seq === 0) {
      // 4096 ids within one millisecond: step into the next so ordering holds.
      ts += 1;
      lastMs = ts;
    }
  } else {
    lastMs = ts;
    seq = 0;
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    randomFillSync(bytes);
  }

  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts / 2 ** 24) & 0xff;
  bytes[3] = (ts / 2 ** 16) & 0xff;
  bytes[4] = (ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = 0x70 | ((seq >>> 8) & 0x0f); // version 7 | rand_a high nibble
  bytes[7] = seq & 0xff; // rand_a low byte
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
