import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertAdmissionAction,
  assertManualBedStatus,
  MANUAL_BED_STATUSES,
  bedUnavailable,
  isManualBedStatus,
} from '../../../src/modules/inpatient/domain/inpatient-flow';

describe('inpatient-flow: admission status machine', () => {
  it('maps discharge to DISCHARGED from ADMITTED only', () => {
    expect(assertAdmissionAction('ADMITTED', 'discharge')).toBe('DISCHARGED');
  });

  it('rejects discharge from a non-ADMITTED admission', () => {
    try {
      assertAdmissionAction('DISCHARGED', 'discharge');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
    }
  });
});

describe('inpatient-flow: bed status rules', () => {
  it('exposes the operator-settable statuses and blocks OCCUPIED', () => {
    expect(MANUAL_BED_STATUSES).toContain('AVAILABLE');
    expect(MANUAL_BED_STATUSES).toContain('RESERVED');
    expect(MANUAL_BED_STATUSES).toContain('CLEANING');
    expect(MANUAL_BED_STATUSES).toContain('MAINTENANCE');
    expect(MANUAL_BED_STATUSES).toContain('BLOCKED');
    expect(MANUAL_BED_STATUSES).not.toContain('OCCUPIED');
    expect(isManualBedStatus('OCCUPIED')).toBe(false);
  });

  it('rejects OCCUPIED as a manually set status', () => {
    try {
      assertManualBedStatus('OCCUPIED');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(assertManualBedStatus('CLEANING')).toBe('CLEANING');
  });

  it('produces BED_UNAVAILABLE errors', () => {
    expect(bedUnavailable('busy').code).toBe(ErrorCodes.BED_UNAVAILABLE);
  });
});