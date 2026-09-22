import {
  assertPasswordPolicy,
  burnPasswordTiming,
  hashPassword,
  isPasswordPolicySatisfied,
  verifyPassword,
} from '../../../src/common/security/password';

describe('password policy', () => {
  it('accepts a policy-conforming password', () => {
    expect(isPasswordPolicySatisfied('DemoPass123!')).toBe(true);
    expect(() => assertPasswordPolicy('DemoPass123!')).not.toThrow();
  });

  it('rejects too-short, all-lowercase, all-uppercase and digit-free passwords', () => {
    expect(isPasswordPolicySatisfied('Abc123!')).toBe(false); // < 8 chars
    expect(isPasswordPolicySatisfied('abcdefgh')).toBe(false); // no upper/digit/special
    expect(isPasswordPolicySatisfied('ABCDEFGH1')).toBe(false); // no lower
    expect(isPasswordPolicySatisfied('abcdefghX')).toBe(false); // no digit
    expect(() => assertPasswordPolicy('weak')).toThrow();
  });
});

describe('argon2 round-trip', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('DemoPass123!');
    expect(hash.startsWith('$argon2')).toBe(true);
    expect(await verifyPassword('DemoPass123!', hash)).toBe(true);
    expect(await verifyPassword('Wr0ngPass!', hash)).toBe(false);
  });

  it('rotates salts between hashes of the same password', async () => {
    const a = await hashPassword('DemoPass123!');
    const b = await hashPassword('DemoPass123!');
    expect(a).not.toBe(b);
  });

  it('burnPasswordTiming is a no-op cost-equality knob that resolves', async () => {
    await expect(burnPasswordTiming('DemoPass123!')).resolves.toBeUndefined();
  });
});
