import {
  callerAction,
  escalationDepth,
  formatEmergencyRequestReference,
  generateTrackingToken,
  levelDelayMs,
  normalizePhone,
  parseLevelSeconds,
} from '../../../src/modules/emergency-intake/domain/escalation';

describe('emergency-intake domain: escalation & tokens', () => {
  it('formats a zero-padded EMR reference with the UTC year', () => {
    expect(formatEmergencyRequestReference(42)).toBe(`EMR-${new Date().getUTCFullYear()}-000042`);
  });

  it('generates a fresh tracking token and a matching sha256 hash', () => {
    const a = generateTrackingToken();
    const b = generateTrackingToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toHaveLength(32);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token).not.toBe(a.tokenHash);
    expect(b.tokenHash).not.toBe(a.tokenHash);
  });

  it('normalizes phones to digits plus a leading +', () => {
    expect(normalizePhone('+254 712 345 678')).toBe('+254712345678');
    expect(normalizePhone('0 712-345-678')).toBe('0712345678');
    expect(normalizePhone('(020) 555 0100')).toBe('0205550100');
  });

  it('parses level seconds, falling back to the 2/5/15-minute defaults', () => {
    expect(parseLevelSeconds([120, 300, 900])).toEqual([120, 300, 900]);
    expect(parseLevelSeconds('garbage')).toEqual([120, 300, 900]);
    expect(parseLevelSeconds(undefined)).toEqual([120, 300, 900]);
    expect(parseLevelSeconds([0.05, 90])).toEqual([0.05, 90]);
    expect(escalationDepth([60, 120])).toBe(2);
    expect(escalationDepth('garbage')).toBe(3);
  });

  it('treats sub-second windows as milliseconds and >=1 as seconds', () => {
    expect(levelDelayMs(0.05)).toBe(50);
    expect(levelDelayMs(0.12)).toBe(120);
    expect(levelDelayMs(2)).toBe(2000);
    expect(levelDelayMs(900)).toBe(900000);
  });

  it('derives the caller-facing guidance from the read model', () => {
    const base = { status: 'RECEIVED', escalationLevel: 0, acknowledgedAt: null, respondedAt: null };
    expect(callerAction(base)).toBe('WAIT');
    expect(callerAction({ ...base, escalationLevel: 2 })).toBe('CALL_NOW');
    expect(callerAction({ ...base, acknowledgedAt: new Date() })).toBe('WAIT');
    expect(callerAction({ ...base, respondedAt: new Date() })).toBe('HELP_ON_WAY');
    expect(callerAction({ ...base, status: 'CLOSED' })).toBe('WAIT');
    expect(callerAction({ ...base, status: 'CANCELLED' })).toBe('WAIT');
  });
});