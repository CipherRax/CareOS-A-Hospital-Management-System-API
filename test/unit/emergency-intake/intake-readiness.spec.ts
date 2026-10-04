import {
  assertIntakeReady,
  evaluateIntakeReadiness,
  intakeReadinessMessages,
} from '../../../src/modules/emergency-intake/domain/intake-readiness';
import { ErrorCodes } from '../../../src/common/errors/codes';

const CONTACT = { active: true, onCall: true, hasChannel: true };

describe('evaluateIntakeReadiness', () => {
  it('treats a disabled branch as closed rather than misconfigured', () => {
    // A branch nobody enabled has nothing to be ready for; reporting
    // NO_ACTIVE_CONTACTS there would send operators chasing a phantom problem.
    expect(
      evaluateIntakeReadiness({
        enabled: false,
        autoEscalate: true,
        levelSeconds: [120],
        contacts: [],
      }),
    ).toEqual({ ready: false, reasons: [], reachableContacts: 0, offShiftContacts: 0 });
  });

  it('is ready with one reachable on-call contact and an escalation chain', () => {
    const readiness = evaluateIntakeReadiness({
      enabled: true,
      autoEscalate: true,
      levelSeconds: [120, 300],
      contacts: [CONTACT],
    });
    expect(readiness).toEqual({ ready: true, reasons: [], reachableContacts: 1, offShiftContacts: 0 });
  });

  it('refuses with no active contacts', () => {
    const readiness = evaluateIntakeReadiness({
      enabled: true,
      autoEscalate: true,
      levelSeconds: [120],
      contacts: [{ active: false, onCall: true, hasChannel: true }],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain('NO_ACTIVE_CONTACTS');
  });

  it('refuses when every active contact has no way to be reached', () => {
    // The dangerous misconfiguration: a chain exists but nobody can be told.
    const readiness = evaluateIntakeReadiness({
      enabled: true,
      autoEscalate: true,
      levelSeconds: [120],
      contacts: [{ active: true, onCall: true, hasChannel: false }],
    });
    expect(readiness.reasons).toContain('NO_CONTACT_CHANNEL');
    expect(readiness.reachableContacts).toBe(0);
  });

  it('does not count an off-call contact as reachable', () => {
    const readiness = evaluateIntakeReadiness({
      enabled: true,
      autoEscalate: true,
      levelSeconds: [120],
      contacts: [{ active: true, onCall: false, hasChannel: true }],
    });
    expect(readiness.reasons).toContain('NO_CONTACT_CHANNEL');
  });

  it('counts a contact bound to a staff user as reachable without a phone', () => {
    // hasChannel is true because the user's own phone is the channel.
    expect(
      evaluateIntakeReadiness({
        enabled: true,
        autoEscalate: true,
        levelSeconds: [120],
        contacts: [{ active: true, onCall: true, hasChannel: true }],
      }).ready,
    ).toBe(true);
  });

  it('refuses with no escalation levels', () => {
    const readiness = evaluateIntakeReadiness({
      enabled: true,
      autoEscalate: true,
      levelSeconds: [],
      contacts: [CONTACT],
    });
    expect(readiness.reasons).toContain('NO_ESCALATION_LEVELS');
  });

  it('refuses when auto-escalation is off', () => {
    // Otherwise an unanswered request is never escalated to anyone.
    const readiness = evaluateIntakeReadiness({
      enabled: true,
      autoEscalate: false,
      levelSeconds: [120],
      contacts: [CONTACT],
    });
    expect(readiness.reasons).toContain('AUTO_ESCALATE_OFF');
  });

  it('reports every unmet condition at once so operators can fix them together', () => {
    const readiness = evaluateIntakeReadiness({
      enabled: true,
      autoEscalate: false,
      levelSeconds: [],
      contacts: [],
    });
    expect(readiness.reasons).toEqual(
      expect.arrayContaining(['NO_ACTIVE_CONTACTS', 'NO_ESCALATION_LEVELS', 'AUTO_ESCALATE_OFF']),
    );
  });
});

describe('intakeReadinessMessages', () => {
  it('explains every reason in operator-facing language', () => {
    const messages = intakeReadinessMessages(['NO_ACTIVE_CONTACTS', 'AUTO_ESCALATE_OFF']);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/on-call contact/i);
    expect(messages[1]).toMatch(/escalation/i);
  });
});

describe('assertIntakeReady', () => {
  it('does not throw when ready', () => {
    expect(() =>
      assertIntakeReady(
        { ready: true, reasons: [], reachableContacts: 1, offShiftContacts: 0 },
        'branch-1',
      ),
    ).not.toThrow();
  });

  it('throws EMERGENCY_INTAKE_NOT_READY with the reasons attached', () => {
    const err = (() => {
      try {
        assertIntakeReady(
          { ready: false, reasons: ['NO_ACTIVE_CONTACTS'], reachableContacts: 0, offShiftContacts: 0 },
          'branch-1',
        );
        return null;
      } catch (e) {
        return e as { code: string; details: { reasons: string[] } };
      }
    })();
    expect(err?.code).toBe(ErrorCodes.EMERGENCY_INTAKE_NOT_READY);
    expect(err?.details.reasons).toEqual(['NO_ACTIVE_CONTACTS']);
  });
});