import { isUuid, newId } from '../../src/common/lib/uuidv7';

describe('uuidv7 (newId)', () => {
  it('returns a UUID-shaped string', () => {
    expect(isUuid(newId())).toBe(true);
  });

  it('has version (v7) and variant bits set correctly', () => {
    const id = newId();
    const mid = id.slice(14, 15); // version nibble, chars 14-15
    expect(mid).toBe('7');
    const variant = parseInt(id.slice(19, 20), 16);
    expect(variant & 0x8).toBe(0x8);
    expect(variant & 0x4).toBe(0);
  });

  it('monotonically increases within the same millisecond window', () => {
    const a = newId();
    const b = newId();
    expect(a.localeCompare(b)).toBeLessThanOrEqual(0);
  });
});

describe('isUuid', () => {
  it('rejects malformed values', () => {
    expect(isUuid('nope')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(1234)).toBe(false);
    expect(isUuid('00000000-0000-7000-8000-000000000001')).toBe(true);
  });
});
