import { Prisma } from '@prisma/client';
import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertFieldValue,
  assertLabAction,
  assertOrderVerifiedForRelease,
  classifyFieldValue,
  computeTurnaroundMinutes,
  sampleStatusForOrder,
  type LabAction,
} from '../../../src/modules/laboratory/domain/lab-flow';

function dec(n: string | number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

describe('lab-flow: order status machine', () => {
  it('maps each lifecycle action to its target status', () => {
    expect(assertLabAction({ status: 'ORDERED' }, 'collect')).toBe('COLLECTED');
    expect(assertLabAction({ status: 'COLLECTED' }, 'receive')).toBe('RECEIVED');
    expect(assertLabAction({ status: 'RECEIVED' }, 'process')).toBe('PROCESSING');
    expect(assertLabAction({ status: 'PROCESSING' }, 'enter_results')).toBe('RESULT_READY');
    expect(assertLabAction({ status: 'RESULT_READY' }, 'verify')).toBe('VERIFIED');
    expect(assertLabAction({ status: 'VERIFIED' }, 'release')).toBe('RELEASED');
    expect(assertLabAction({ status: 'COLLECTED' }, 'reject')).toBe('REJECTED');
    expect(assertLabAction({ status: 'ORDERED' }, 'cancel')).toBe('CANCELLED');
  });

  it('rejects transitions from the wrong current status', () => {
    const cases: Array<[Parameters<typeof assertLabAction>[0]['status'], LabAction]> = [
      ['ORDERED', 'receive'],
      ['RECEIVED', 'enter_results'],
      ['PROCESSING', 'verify'],
      ['RESULT_READY', 'release'],
      ['RELEASED', 'release'],
      ['REJECTED', 'cancel'],
      ['CANCELLED', 'collect'],
    ];
    for (const [status, action] of cases) {
      try {
        assertLabAction({ status }, action);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });
});

describe('lab-flow: release requires verification', () => {
  it('allows release only from VERIFIED', () => {
    expect(() => assertOrderVerifiedForRelease({ status: 'VERIFIED' })).not.toThrow();
  });

  it('raises LAB_RESULT_NOT_VERIFIED from any pre-verified status', () => {
    for (const status of ['ORDERED', 'RESULT_READY', 'PROCESSING'] as const) {
      try {
        assertOrderVerifiedForRelease({ status });
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.LAB_RESULT_NOT_VERIFIED);
      }
    }
  });
});

describe('lab-flow: sample mirrors the order', () => {
  it('maps terminal order statuses to a completed sample', () => {
    expect(sampleStatusForOrder('RESULT_READY')).toBe('COMPLETED');
    expect(sampleStatusForOrder('VERIFIED')).toBe('COMPLETED');
    expect(sampleStatusForOrder('RELEASED')).toBe('COMPLETED');
  });

  it('keeps a cancelled order sample inert (never falsely rejected)', () => {
    expect(sampleStatusForOrder('CANCELLED')).toBe('ORDERED');
  });

  it('tracks the mid-lifecycle statuses', () => {
    expect(sampleStatusForOrder('COLLECTED')).toBe('COLLECTED');
    expect(sampleStatusForOrder('RECEIVED')).toBe('RECEIVED');
    expect(sampleStatusForOrder('PROCESSING')).toBe('PROCESSING');
    expect(sampleStatusForOrder('REJECTED')).toBe('REJECTED');
  });
});

describe('lab-flow: field value validation', () => {
  it('accepts a finite numeric value for a NUMERIC field', () => {
    expect(() =>
      assertFieldValue({ name: 'Glucose', fieldType: 'NUMERIC', allowsValues: null }, '5.4'),
    ).not.toThrow();
  });

  it('rejects non-numeric text on a NUMERIC field', () => {
    try {
      assertFieldValue({ name: 'Glucose', fieldType: 'NUMERIC', allowsValues: null }, 'abc');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('enforces the configured allowsValues list for categorical fields', () => {
    const field = { name: 'Blood group', fieldType: 'CATEGORICAL' as const, allowsValues: 'A,B,O,AB' };
    expect(() => assertFieldValue(field, 'AB')).not.toThrow();
    try {
      assertFieldValue(field, 'C');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rejects an empty value', () => {
    try {
      assertFieldValue({ name: 'Notes', fieldType: 'TEXT', allowsValues: null }, '   ');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});

describe('lab-flow: classification from configured ranges only', () => {
  const field = {
    fieldType: 'NUMERIC' as const,
    referenceMin: dec(4),
    referenceMax: dec(6),
    criticalMin: dec(2),
    criticalMax: dec(10),
  };

  it('flags nothing inside the reference window', () => {
    expect(classifyFieldValue(field, '5')).toEqual({ isAbnormal: false, isCritical: false });
  });

  it('flags abnormal when outside reference but inside critical', () => {
    expect(classifyFieldValue(field, '7')).toEqual({ isAbnormal: true, isCritical: false });
    expect(classifyFieldValue(field, '3')).toEqual({ isAbnormal: true, isCritical: false });
  });

  it('flags critical when beyond a critical threshold', () => {
    expect(classifyFieldValue(field, '11')).toEqual({ isAbnormal: true, isCritical: true });
    expect(classifyFieldValue(field, '1')).toEqual({ isAbnormal: true, isCritical: true });
  });

  it('never flags a non-numeric field automatically', () => {
    expect(
      classifyFieldValue(
        {
          fieldType: 'TEXT',
          referenceMin: dec(0),
          referenceMax: dec(0),
          criticalMin: dec(0),
          criticalMax: dec(0),
        },
        'anything',
      ),
    ).toEqual({ isAbnormal: false, isCritical: false });
  });

  it('does not flag when no limits are configured', () => {
    expect(
      classifyFieldValue(
        {
          fieldType: 'NUMERIC',
          referenceMin: null,
          referenceMax: null,
          criticalMin: null,
          criticalMax: null,
        },
        '9999',
      ),
    ).toEqual({ isAbnormal: false, isCritical: false });
  });
});

describe('lab-flow: turnaround time', () => {
  it('returns whole minutes between collection and release', () => {
    const collected = new Date('2026-01-01T10:00:00Z');
    const released = new Date('2026-01-01T12:30:00Z');
    expect(computeTurnaroundMinutes(collected, released)).toBe(150);
  });
});
