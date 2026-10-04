import {
  callerAction,
  callerActionMessage,
  callerStatusLabel,
  emergencyCallNowError,
  emergencyNumbersPayload,
  EMERGENCY_DISCLAIMER,
  isTerminalStatus,
  stopsEscalation,
} from '../../../src/modules/emergency-intake/domain/caller-copy';
import { EMERGENCY_CONSENT_VERSION } from '../../../src/modules/emergency-intake/domain/consent';
import { ErrorCodes } from '../../../src/common/errors/codes';

const OPEN = {
  status: 'RECEIVED',
  escalationLevel: 0,
  acknowledgedAt: null,
  respondedAt: null,
};

describe('callerAction', () => {
  it('tells a fresh caller to wait', () => {
    expect(callerAction(OPEN)).toBe('WAIT');
  });

  it('only claims help is on the way once a responder is recorded', () => {
    // The one claim that implies help, so it requires an explicit staff action.
    expect(callerAction({ ...OPEN, respondedAt: new Date() })).toBe('HELP_ON_WAY');
  });

  it('says call now once escalation has started without acknowledgement', () => {
    expect(callerAction({ ...OPEN, escalationLevel: 1 })).toBe('CALL_NOW');
  });

  it('says wait while a staff member has acknowledged but not yet responded', () => {
    expect(callerAction({ ...OPEN, escalationLevel: 2, acknowledgedAt: new Date() })).toBe('WAIT');
  });

  it('prefers HELP_ON_WAY over CALL_NOW once responding', () => {
    expect(
      callerAction({ ...OPEN, escalationLevel: 3, respondedAt: new Date() }),
    ).toBe('HELP_ON_WAY');
  });

  it('never promises anything after a caller cancels', () => {
    expect(callerAction({ ...OPEN, status: 'CANCELLED' })).toBe('WAIT');
  });

  it.each(['UNREACHABLE', 'NOT_ACTIONABLE', 'DUPLICATE'])(
    'tells the caller to phone when the facility finished with the request as %s',
    (status) => {
      // The unsafe failure mode: telling someone to keep waiting when nothing
      // more will happen and no responder is confirmed.
      expect(callerAction({ ...OPEN, status })).toBe('CALL_NOW');
    },
  );

  it('treats a contacted caller as still waiting, not as help on the way', () => {
    expect(callerAction({ ...OPEN, status: 'CONTACTED', escalationLevel: 1 })).toBe('WAIT');
  });

  it('treats a closed request as finished rather than call-now', () => {
    expect(callerAction({ ...OPEN, status: 'CLOSED' })).toBe('WAIT');
  });
});

describe('callerStatusLabel', () => {
  it('labels every known status in plain language', () => {
    expect(callerStatusLabel('RESPONDING')).toBe('Response team assigned');
    expect(callerStatusLabel('UNREACHABLE')).toBe('Facility could not reach you');
    expect(callerStatusLabel('REDIRECTED')).toBe('Redirected');
  });

  it('falls back to a safe label for an unknown status', () => {
    // Never echoes an unrecognized internal value to a caller.
    expect(callerStatusLabel('SOMETHING_NEW')).toBe('Received');
  });
});

describe('callerActionMessage', () => {
  it('has a distinct message per action', () => {
    const messages = (['WAIT', 'CALL_NOW', 'HELP_ON_WAY'] as const).map(callerActionMessage);
    expect(new Set(messages).size).toBe(3);
  });

  it('frames CALL_NOW as the caller acting, not us dispatching', () => {
    expect(callerActionMessage('CALL_NOW')).toMatch(/call/i);
  });
});

describe('isTerminalStatus / stopsEscalation', () => {
  it('treats closed, cancelled, redirected, unreachable, not-actionable and duplicate as finished', () => {
    for (const status of [
      'CLOSED',
      'CANCELLED',
      'REDIRECTED',
      'UNREACHABLE',
      'NOT_ACTIONABLE',
      'DUPLICATE',
    ]) {
      expect(isTerminalStatus(status)).toBe(true);
    }
    expect(isTerminalStatus('RECEIVED')).toBe(false);
    expect(isTerminalStatus('RESPONDING')).toBe(false);
  });

  it('keeps escalating only for the two keyboard states', () => {
    // ESCALATED must keep escalating (each level flips the read model to it);
    // everything else a human set means stop.
    expect(stopsEscalation('RECEIVED')).toBe(false);
    expect(stopsEscalation('ESCALATED')).toBe(false);
    expect(stopsEscalation('ACKNOWLEDGED')).toBe(true);
    expect(stopsEscalation('CONTACTED')).toBe(true);
    expect(stopsEscalation('RESPONDING')).toBe(true);
    expect(stopsEscalation('UNREACHABLE')).toBe(true);
  });
});

describe('emergencyCallNowError', () => {
  it('always carries CALL_NOW, the national numbers, and the disclaimer', () => {
    const err = emergencyCallNowError({ message: 'Facility cannot take this request.' });
    expect(err.code).toBe(ErrorCodes.EMERGENCY_CALL_NOW);
    expect(err.details?.action).toBe('CALL_NOW');
    const numbers = err.details?.numbers as Array<{ phone: string; purpose: string }>;
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.map((n) => n.purpose)).toEqual(
      expect.arrayContaining(['ambulance', 'police', 'national']),
    );
    expect(err.details?.disclaimer).toBe(EMERGENCY_DISCLAIMER);
    // careOS must not imply it dispatches or guarantees a response.
    expect(err.details?.disclaimer).toMatch(/does not dispatch/i);
  });

  it('merges caller-supplied details without dropping the safety payload', () => {
    const err = emergencyCallNowError({
      message: 'x',
      details: { facilityPhone: '+254 20 555 0100' },
    });
    expect(err.details?.facilityPhone).toBe('+254 20 555 0100');
    expect(err.details?.action).toBe('CALL_NOW');
  });
});

describe('emergencyNumbersPayload', () => {
  it('normalises optional hours to null rather than undefined', () => {
    const [first] = emergencyNumbersPayload([
      { country: 'KE', purpose: 'ambulance', label: 'x', phone: '199' },
    ]);
    expect(first).toEqual({
      purpose: 'ambulance',
      label: 'x',
      phone: '199',
      hours: null,
    });
  });
});

describe('consent', () => {
  it('exposes a versioned disclosure identifier', () => {
    // Callers must be able to record which disclosure wording they accepted.
    expect(EMERGENCY_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});