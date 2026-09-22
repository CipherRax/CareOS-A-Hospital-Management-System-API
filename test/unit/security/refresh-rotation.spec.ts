import {
  classifyRefreshToken,
  classifySession,
} from '../../../src/common/auth/refresh-rotation';

const now = new Date('2026-09-21T12:00:00Z');
const past = new Date('2026-09-21T11:00:00Z');
const future = new Date('2026-09-21T13:00:00Z');

describe('refresh-token rotation classification', () => {
  it('classifies an unused, unrevoked, unexpired token as current', () => {
    expect(classifyRefreshToken({ expiresAt: future }, now)).toBe('current');
  });

  it('classifies a used-an-or-previously-rotated token as reuse', () => {
    expect(classifyRefreshToken({ usedAt: past, expiresAt: future }, now)).toBe('reuse');
    expect(classifyRefreshToken({ usedAt: past, expiresAt: future }, now)).toBe('reuse');
  });

  it('classifies a revoked token as reuse', () => {
    expect(classifyRefreshToken({ revokedAt: past, expiresAt: future }, now)).toBe(
      'reuse',
    );
  });

  it('classifies an expired token as unknown (attacker window closed)', () => {
    expect(classifyRefreshToken({ expiresAt: past }, now)).toBe('unknown');
  });
});

describe('session classification', () => {
  it('is valid only when unrevoked, unsuspended and unexpired', () => {
    expect(classifySession({ expiresAt: future }, now)).toBe('valid');
  });

  it('is revoked once the session or user is suspended/revoked', () => {
    expect(classifySession({ revokedAt: past, expiresAt: future }, now)).toBe('revoked');
    expect(classifySession({ suspendedAt: past, expiresAt: future }, now)).toBe(
      'revoked',
    );
  });

  it('is expired past the absolute TTL', () => {
    expect(classifySession({ expiresAt: past }, now)).toBe('expired');
  });
});
