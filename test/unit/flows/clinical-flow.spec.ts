import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertFollowUpAction,
  targetStatusForAction,
} from '../../../src/modules/follow-ups/domain/follow-up-flow';
import {
  assertReferralAction,
  REFERRAL_ACTION_TARGETS,
} from '../../../src/modules/referrals/domain/referral-flow';
import {
  assertTaskAction,
  TASK_ACTION_TARGETS,
} from '../../../src/modules/tasks/domain/task-flow';

describe('follow-up-flow', () => {
  it('maps complete/cancel to COMPLETED/CANCELLED from SCHEDULED or REMINDED', () => {
    expect(targetStatusForAction({ status: 'SCHEDULED' }, 'complete')).toBe('COMPLETED');
    expect(targetStatusForAction({ status: 'SCHEDULED' }, 'cancel')).toBe('CANCELLED');
    expect(targetStatusForAction({ status: 'REMINDED' }, 'complete')).toBe('COMPLETED');
  });

  it('rejects actions on terminal statuses', () => {
    for (const status of ['COMPLETED', 'MISSED', 'CANCELLED'] as const) {
      try {
        assertFollowUpAction({ status });
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });
});

describe('referral-flow', () => {
  it('maps every action to its target status', () => {
    expect(REFERRAL_ACTION_TARGETS).toEqual({
      send: 'SENT',
      accept: 'ACCEPTED',
      reject: 'REJECTED',
      complete: 'COMPLETED',
      cancel: 'CANCELLED',
    });
  });

  it('walks the happy path CREATED → SENT → ACCEPTED → COMPLETED', () => {
    expect(assertReferralAction({ status: 'CREATED' }, 'send')).toBe('SENT');
    expect(assertReferralAction({ status: 'SENT' }, 'accept')).toBe('ACCEPTED');
    expect(assertReferralAction({ status: 'ACCEPTED' }, 'complete')).toBe('COMPLETED');
  });

  it('rejects out-of-order actions', () => {
    const cases: Array<[string, 'send' | 'accept' | 'reject' | 'complete' | 'cancel']> = [
      ['CREATED', 'accept'],
      ['CREATED', 'complete'],
      ['SENT', 'send'],
      ['ACCEPTED', 'accept'],
      ['REJECTED', 'send'],
      ['COMPLETED', 'send'],
    ];
    for (const [status, action] of cases) {
      try {
        assertReferralAction({ status: status as never }, action);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });
});

describe('task-flow', () => {
  it('maps start/complete/cancel and allows OPEN or IN_PROGRESS completion', () => {
    expect(TASK_ACTION_TARGETS).toEqual({ start: 'IN_PROGRESS', complete: 'DONE', cancel: 'CANCELLED' });
    expect(assertTaskAction('OPEN', 'start')).toBe('IN_PROGRESS');
    expect(assertTaskAction('OPEN', 'complete')).toBe('DONE');
    expect(assertTaskAction('IN_PROGRESS', 'complete')).toBe('DONE');
    expect(assertTaskAction('IN_PROGRESS', 'cancel')).toBe('CANCELLED');
  });

  it('rejects starting a non-OPEN task and reopening terminal states', () => {
    const cases: Array<[string, 'start' | 'complete' | 'cancel']> = [
      ['IN_PROGRESS', 'start'],
      ['DONE', 'start'],
      ['DONE', 'complete'],
      ['CANCELLED', 'cancel'],
      ['DONE', 'cancel'],
    ];
    for (const [status, action] of cases) {
      try {
        assertTaskAction(status as never, action);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });
});