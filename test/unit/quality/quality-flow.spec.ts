import { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertComplaintAssignmentAllowed,
  assertComplaintClosure,
  assertComplaintTransition,
  assertFeedbackRespondRules,
  assertFeedbackTransition,
  assertIncidentTransition,
  COMPLAINT_TRANSITIONS,
  FEEDBACK_TRANSITIONS,
  INCIDENT_TRANSITIONS,
} from '../../../src/modules/quality/domain/quality-flow';

function expectWorkflowError(fn: () => void): void {
  try {
    fn();
    throw new Error('expected throw');
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  }
}

describe('quality-flow: feedback', () => {
  it('exposes the legal NEW → ACKNOWLEDGED → RESOLVED → CLOSED chain', () => {
    expect(FEEDBACK_TRANSITIONS.NEW).toEqual(['ACKNOWLEDGED']);
    expect(FEEDBACK_TRANSITIONS.ACKNOWLEDGED).toEqual(['RESOLVED']);
    expect(FEEDBACK_TRANSITIONS.RESOLVED).toEqual(['CLOSED']);
    expect(FEEDBACK_TRANSITIONS.CLOSED).toEqual([]);
  });

  it('allows every legal transition', () => {
    for (const [from, to] of [
      ['NEW', 'ACKNOWLEDGED'],
      ['ACKNOWLEDGED', 'RESOLVED'],
      ['RESOLVED', 'CLOSED'],
    ] as const) {
      expect(() => assertFeedbackTransition(from, to)).not.toThrow();
    }
  });

  it('allows idempotent same-status patches', () => {
    expect(() => assertFeedbackTransition('NEW', 'NEW')).not.toThrow();
    expect(() => assertFeedbackTransition('CLOSED', 'CLOSED')).not.toThrow();
  });

  it('rejects illegal and backward transitions', () => {
    for (const [from, to] of [
      ['NEW', 'RESOLVED'],
      ['NEW', 'CLOSED'],
      ['ACKNOWLEDGED', 'NEW'],
      ['CLOSED', 'ACKNOWLEDGED'],
    ] as const) {
      expectWorkflowError(() => assertFeedbackTransition(from, to));
    }
  });

  it('requires a response before feedback can leave NEW', () => {
    expectWorkflowError(() =>
      assertFeedbackRespondRules({
        current: 'NEW',
        next: 'ACKNOWLEDGED',
      }),
    );
    expect(() =>
      assertFeedbackRespondRules({
        current: 'NEW',
        next: 'ACKNOWLEDGED',
        response: 'Thank you for your feedback.',
      }),
    ).not.toThrow();
  });

  it('accepts the stored response when only the status changes', () => {
    expect(() =>
      assertFeedbackRespondRules({
        current: 'ACKNOWLEDGED',
        next: 'RESOLVED',
        existingResponse: 'Acknowledged.',
      }),
    ).not.toThrow();
  });
});

describe('quality-flow: complaints', () => {
  it('exposes the legal OPEN → ASSIGNED → INVESTIGATING → RESOLVED → CLOSED chain', () => {
    expect(COMPLAINT_TRANSITIONS.OPEN).toEqual(['ASSIGNED']);
    expect(COMPLAINT_TRANSITIONS.ASSIGNED).toEqual(['INVESTIGATING']);
    expect(COMPLAINT_TRANSITIONS.INVESTIGATING).toEqual(['RESOLVED']);
    expect(COMPLAINT_TRANSITIONS.RESOLVED).toEqual(['CLOSED']);
    expect(COMPLAINT_TRANSITIONS.CLOSED).toEqual([]);
  });

  it('allows every legal transition', () => {
    for (const [from, to] of [
      ['OPEN', 'ASSIGNED'],
      ['ASSIGNED', 'INVESTIGATING'],
      ['INVESTIGATING', 'RESOLVED'],
      ['RESOLVED', 'CLOSED'],
    ] as const) {
      expect(() => assertComplaintTransition(from, to)).not.toThrow();
    }
  });

  it('rejects skipped and backward transitions', () => {
    for (const [from, to] of [
      ['OPEN', 'INVESTIGATING'],
      ['OPEN', 'RESOLVED'],
      ['ASSIGNED', 'RESOLVED'],
      ['INVESTIGATING', 'CLOSED'],
      ['CLOSED', 'OPEN'],
      ['RESOLVED', 'INVESTIGATING'],
    ] as const) {
      expectWorkflowError(() => assertComplaintTransition(from, to));
    }
  });

  it('cannot close a complaint without a resolution', () => {
    expectWorkflowError(() =>
      assertComplaintClosure('RESOLVED', 'CLOSED', undefined),
    );
    expectWorkflowError(() => assertComplaintClosure('RESOLVED', 'CLOSED', ''));
    expectWorkflowError(() => assertComplaintClosure('RESOLVED', 'CLOSED', '   '));
  });

  it('closes when a resolution is provided or already stored', () => {
    expect(() =>
      assertComplaintClosure('RESOLVED', 'CLOSED', 'Compensated the patient.'),
    ).not.toThrow();
    expect(() =>
      assertComplaintClosure('RESOLVED', 'CLOSED', 'Handled during investigation.'),
    ).not.toThrow();
  });

  it('enforces assignment only on ASSIGNED or INVESTIGATING', () => {
    expect(() => assertComplaintAssignmentAllowed('ASSIGNED')).not.toThrow();
    expect(() => assertComplaintAssignmentAllowed('INVESTIGATING')).not.toThrow();
    for (const status of ['OPEN', 'RESOLVED', 'CLOSED'] as const) {
      expectWorkflowError(() => assertComplaintAssignmentAllowed(status));
    }
  });
});

describe('quality-flow: incidents', () => {
  it('exposes the legal OPEN → INVESTIGATING → ACTION_PLAN → RESOLVED → CLOSED chain', () => {
    expect(INCIDENT_TRANSITIONS.OPEN).toEqual(['INVESTIGATING']);
    expect(INCIDENT_TRANSITIONS.INVESTIGATING).toEqual(['ACTION_PLAN']);
    expect(INCIDENT_TRANSITIONS.ACTION_PLAN).toEqual(['RESOLVED']);
    expect(INCIDENT_TRANSITIONS.RESOLVED).toEqual(['CLOSED']);
    expect(INCIDENT_TRANSITIONS.CLOSED).toEqual([]);
  });

  it('allows every legal transition', () => {
    for (const [from, to] of [
      ['OPEN', 'INVESTIGATING'],
      ['INVESTIGATING', 'ACTION_PLAN'],
      ['ACTION_PLAN', 'RESOLVED'],
      ['RESOLVED', 'CLOSED'],
    ] as const) {
      expect(() => assertIncidentTransition(from, to)).not.toThrow();
    }
  });

  it('rejects skipped and backward transitions', () => {
    for (const [from, to] of [
      ['OPEN', 'ACTION_PLAN'],
      ['OPEN', 'RESOLVED'],
      ['INVESTIGATING', 'RESOLVED'],
      ['ACTION_PLAN', 'CLOSED'],
      ['CLOSED', 'RESOLVED'],
    ] as const) {
      expectWorkflowError(() => assertIncidentTransition(from, to));
    }
  });
});