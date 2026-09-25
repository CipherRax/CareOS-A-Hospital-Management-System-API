import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertEmergencyAction,
  isEmergencyTerminal,
  type EmergencyAction,
} from '../../../src/modules/emergency/domain/emergency-flow';

describe('emergency-flow: visit status machine', () => {
  it('maps each lifecycle action to its target status', () => {
    expect(assertEmergencyAction('ARRIVED', 'triage')).toBe('TRIAGED');
    expect(assertEmergencyAction('TRIAGED', 'assess')).toBe('ASSESSED');
    expect(assertEmergencyAction('ASSESSED', 'treat')).toBe('IN_TREATMENT');
    expect(assertEmergencyAction('ASSESSED', 'observe')).toBe('OBSERVATION');
    expect(assertEmergencyAction('IN_TREATMENT', 'observe')).toBe('OBSERVATION');
    expect(assertEmergencyAction('ASSESSED', 'admit')).toBe('ADMITTED');
    expect(assertEmergencyAction('IN_TREATMENT', 'refer')).toBe('REFERRED');
    expect(assertEmergencyAction('OBSERVATION', 'discharge')).toBe('DISCHARGED');
  });

  it('accepts assess/treat/observe/admit/refer/discharge from the legal sources', () => {
    const allowed: Array<[string, EmergencyAction]> = [
      ['TRIAGED', 'assess'],
      ['ASSESSED', 'treat'],
      ['ASSESSED', 'observe'],
      ['IN_TREATMENT', 'observe'],
      ['ASSESSED', 'admit'],
      ['IN_TREATMENT', 'admit'],
      ['OBSERVATION', 'admit'],
      ['ASSESSED', 'refer'],
      ['ASSESSED', 'discharge'],
    ];
    for (const [status, action] of allowed) {
      expect(assertEmergencyAction(status as Parameters<typeof assertEmergencyAction>[0], action)).toBeTruthy();
    }
  });

  it('rejects transitions from the wrong current status', () => {
    const cases: Array<[Parameters<typeof assertEmergencyAction>[0], EmergencyAction]> = [
      ['ARRIVED', 'assess'],
      ['ARRIVED', 'admit'],
      ['ARRIVED', 'discharge'],
      ['TRIAGED', 'treat'],
      ['TRIAGED', 'discharge'],
      ['ASSESSED', 'triage'],
      ['IN_TREATMENT', 'assess'],
      ['OBSERVATION', 'treat'],
      ['DISCHARGED', 'observe'],
      ['ADMITTED', 'discharge'],
      ['REFERRED', 'refer'],
    ];
    for (const [status, action] of cases) {
      try {
        assertEmergencyAction(status, action);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });

  it('classifies dispositions as terminal', () => {
    expect(isEmergencyTerminal('DISCHARGED')).toBe(true);
    expect(isEmergencyTerminal('ADMITTED')).toBe(true);
    expect(isEmergencyTerminal('REFERRED')).toBe(true);
    expect(isEmergencyTerminal('ARRIVED')).toBe(false);
    expect(isEmergencyTerminal('OBSERVATION')).toBe(false);
  });
});