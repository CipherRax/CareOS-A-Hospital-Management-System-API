import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertRadiologyAction,
  type RadiologyAction,
} from '../../../src/modules/radiology/domain/radiology-flow';

describe('radiology-flow: order status machine', () => {
  it('maps each lifecycle action to its target status', () => {
    expect(assertRadiologyAction({ status: 'ORDERED' }, 'schedule')).toBe('SCHEDULED');
    expect(assertRadiologyAction({ status: 'SCHEDULED' }, 'perform')).toBe('PERFORMED');
    expect(assertRadiologyAction({ status: 'PERFORMED' }, 'report')).toBe('REPORTED');
    expect(assertRadiologyAction({ status: 'REPORTED' }, 'verify')).toBe('VERIFIED');
    expect(assertRadiologyAction({ status: 'VERIFIED' }, 'release')).toBe('RELEASED');
    expect(assertRadiologyAction({ status: 'ORDERED' }, 'cancel')).toBe('CANCELLED');
    expect(assertRadiologyAction({ status: 'SCHEDULED' }, 'cancel')).toBe('CANCELLED');
  });

  it('rejects transitions from the wrong current status', () => {
    const cases: Array<[Parameters<typeof assertRadiologyAction>[0]['status'], RadiologyAction]> = [
      ['ORDERED', 'perform'],
      ['PERFORMED', 'verify'],
      ['REPORTED', 'release'],
      ['RELEASED', 'release'],
      ['CANCELLED', 'schedule'],
      ['PERFORMED', 'cancel'],
    ];
    for (const [status, action] of cases) {
      try {
        assertRadiologyAction({ status }, action);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });
});
