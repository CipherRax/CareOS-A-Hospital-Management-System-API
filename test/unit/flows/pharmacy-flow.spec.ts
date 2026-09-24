import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertPrescriptionAction,
  prescriptionTargetStatus,
  statusAfterDispense,
} from '../../../src/modules/prescriptions/domain/prescription-flow';
import {
  assertPurchaseOrderAction,
  receiveStateAfterStep,
} from '../../../src/modules/purchase-orders/domain/po-flow';

describe('prescription-flow', () => {
  it('issue and cancel move from the allowed states', () => {
    expect(() => assertPrescriptionAction({ status: 'DRAFT' }, 'issue')).not.toThrow();
    expect(() => assertPrescriptionAction({ status: 'DRAFT' }, 'cancel')).not.toThrow();
    expect(() => assertPrescriptionAction({ status: 'ISSUED' }, 'cancel')).not.toThrow();
  });

  it('rejects illegal moves', () => {
    for (const [status, action] of [
      ['ISSUED', 'issue'],
      ['DISPENSED', 'cancel'],
      ['CANCELLED', 'dispense'],
      ['DISPENSED', 'dispense'],
    ] as const) {
      try {
        assertPrescriptionAction({ status }, action);
        throw new Error(`expected throw ${status} ${action}`);
      } catch (err) {
        expect((err as { code: string }).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });

  it('maps actions to target statuses', () => {
    expect(prescriptionTargetStatus('issue')).toBe('ISSUED');
    expect(prescriptionTargetStatus('cancel')).toBe('CANCELLED');
    expect(prescriptionTargetStatus('dispense')).toBe('DISPENSED');
  });

  it('derives dispense status from cumulative quantities', () => {
    expect(statusAfterDispense(30, 30)).toBe('DISPENSED');
    expect(statusAfterDispense(30, 15)).toBe('PARTIALLY_DISPENSED');
    expect(statusAfterDispense(30, 0)).toBe('PARTIALLY_DISPENSED');
  });
});

describe('po-flow', () => {
  it('advances through the lifecycle', () => {
    expect(() => assertPurchaseOrderAction({ status: 'DRAFT' }, 'submit')).not.toThrow();
    expect(() => assertPurchaseOrderAction({ status: 'SUBMITTED' }, 'approve')).not.toThrow();
    expect(() => assertPurchaseOrderAction({ status: 'APPROVED' }, 'order')).not.toThrow();
    expect(() => assertPurchaseOrderAction({ status: 'ORDERED' }, 'receive')).not.toThrow();
    expect(() => assertPurchaseOrderAction({ status: 'RECEIVED' }, 'close')).not.toThrow();
  });

  it('rejects illegal moves (including terminal states)', () => {
    for (const [status, action] of [
      ['DRAFT', 'approve'],
      ['APPROVED', 'submit'],
      ['CLOSED', 'receive'],
      ['RECEIVED', 'receive'],
    ] as const) {
      try {
        assertPurchaseOrderAction({ status }, action);
        throw new Error(`expected throw ${status} ${action}`);
      } catch (err) {
        expect((err as { code: string }).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    }
  });

  it('derives the post-receive status from completeness', () => {
    expect(receiveStateAfterStep(true)).toBe('RECEIVED');
    expect(receiveStateAfterStep(false)).toBe('PARTIALLY_RECEIVED');
  });
});