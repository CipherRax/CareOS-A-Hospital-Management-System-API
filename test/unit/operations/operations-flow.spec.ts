import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertExpenseAction,
  type ExpenseAction,
} from '../../../src/modules/operations/domain/expense-flow';
import {
  assertAssetRetirable,
  assertAssetTag,
} from '../../../src/modules/operations/domain/asset-flow';
import {
  assertMaintenanceAction,
} from '../../../src/modules/operations/domain/maintenance-flow';
import {
  formatOperationsNumber,
} from '../../../src/modules/operations/domain/operations-number';

function expense(overrides: Partial<Parameters<typeof assertExpenseAction>[0]> = {}) {
  return {
    status: 'DRAFT' as const,
    paymentStatus: 'UNPAID' as const,
    createdById: 'creator-1',
    ...overrides,
  };
}

function codeOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    return (err as { code: string }).code;
  }
  return '';
}

describe('expense-flow: state machine', () => {
  const cases: Array<{ action: ExpenseAction; from: { status: string; paymentStatus?: string }; to: { status: string; paymentStatus?: string } }> = [
    { action: 'update', from: { status: 'DRAFT' }, to: { status: 'DRAFT' } },
    { action: 'submit', from: { status: 'DRAFT' }, to: { status: 'SUBMITTED' } },
    { action: 'approve', from: { status: 'SUBMITTED' }, to: { status: 'APPROVED' } },
    { action: 'reject', from: { status: 'SUBMITTED' }, to: { status: 'REJECTED' } },
    { action: 'pay', from: { status: 'APPROVED', paymentStatus: 'UNPAID' }, to: { status: 'APPROVED', paymentStatus: 'PAID' } },
    { action: 'cancel', from: { status: 'DRAFT' }, to: { status: 'CANCELLED' } },
    { action: 'cancel', from: { status: 'SUBMITTED' }, to: { status: 'CANCELLED' } },
  ];

  it.each(cases)('allows $action from $from.status', ({ action, from }) => {
    const value = expense({
      status: from.status as 'DRAFT',
      paymentStatus: (from.paymentStatus ?? 'UNPAID') as 'UNPAID',
    });
    expect(() =>
      assertExpenseAction(value, action, 'other-user', action === 'reject' ? 'bad doc' : undefined),
    ).not.toThrow();
  });
});

describe('expense-flow: guards', () => {
  it('blocks DRAFT-only edits once submitted', () => {
    expect(codeOf(() => assertExpenseAction(expense({ status: 'SUBMITTED' }), 'update', 'other-user'))).toBe(
      ErrorCodes.EXPENSE_STATE_CONFLICT,
    );
  });

  it('approve/reject are segregation-of-duties: the creator cannot decide own expense', () => {
    expect(codeOf(() => assertExpenseAction(expense({ status: 'SUBMITTED' }), 'approve', 'creator-1'))).toBe(
      ErrorCodes.SEGREGATION_VIOLATION,
    );
    expect(codeOf(() => assertExpenseAction(expense({ status: 'SUBMITTED' }), 'reject', 'creator-1', 'no'))).toBe(
      ErrorCodes.SEGREGATION_VIOLATION,
    );
    // a different user is fine
    expect(() => assertExpenseAction(expense({ status: 'SUBMITTED' }), 'approve', 'other-user')).not.toThrow();
  });

  it('rejection always needs a reason', () => {
    expect(codeOf(() => assertExpenseAction(expense({ status: 'SUBMITTED' }), 'reject', 'other-user', '  '))).toBe(
      ErrorCodes.VALIDATION_ERROR,
    );
  });

  it('only APPROVED + UNPAID expenses can be paid', () => {
    expect(codeOf(() => assertExpenseAction(expense({ status: 'SUBMITTED' }), 'pay', 'other-user'))).toBe(
      ErrorCodes.EXPENSE_STATE_CONFLICT,
    );
    expect(
      codeOf(() =>
        assertExpenseAction(expense({ status: 'APPROVED', paymentStatus: 'PAID' }), 'pay', 'other-user'),
      ),
    ).toBe(ErrorCodes.EXPENSE_ALREADY_PAID);
  });

  it('an APPROVED expense (ledger obligation) cannot be cancelled', () => {
    expect(codeOf(() => assertExpenseAction(expense({ status: 'APPROVED' }), 'cancel', 'other-user'))).toBe(
      ErrorCodes.EXPENSE_STATE_CONFLICT,
    );
  });

  it('cannot re-submit after approval', () => {
    expect(codeOf(() => assertExpenseAction(expense({ status: 'APPROVED' }), 'submit', 'creator-1'))).toBe(
      ErrorCodes.EXPENSE_STATE_CONFLICT,
    );
  });
});

describe('asset-flow', () => {
  it('normalizes asset tags to uppercase and accepts dashes', () => {
    expect(assertAssetTag('  mri-scanner-03 ')).toBe('MRI-SCANNER-03');
  });

  it('rejects characters outside A-Z / 0-9 / dash and over-length tags', () => {
    expect(codeOf(() => assertAssetTag('MRI Scanner 3'))).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(codeOf(() => assertAssetTag('A'.repeat(41)))).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('only ACTIVE/MAINTENANCE assets can be retired', () => {
    expect(() => assertAssetRetirable({ status: 'ACTIVE' })).not.toThrow();
    expect(codeOf(() => assertAssetRetirable({ status: 'RETIRED' }))).toBe(ErrorCodes.ASSET_STATE_CONFLICT);
    expect(codeOf(() => assertAssetRetirable({ status: 'DISPOSED' }))).toBe(ErrorCodes.ASSET_STATE_CONFLICT);
  });
});

describe('maintenance-flow', () => {
  it('starts only PLANNED jobs; completes/cancels from PLANNED or IN_PROGRESS', () => {
    expect(() => assertMaintenanceAction({ status: 'PLANNED' }, 'start')).not.toThrow();
    expect(codeOf(() => assertMaintenanceAction({ status: 'IN_PROGRESS' }, 'start'))).toBe(
      ErrorCodes.MAINTENANCE_STATE_CONFLICT,
    );
    for (const status of ['PLANNED', 'IN_PROGRESS'] as const) {
      expect(() => assertMaintenanceAction({ status }, 'complete')).not.toThrow();
      expect(() => assertMaintenanceAction({ status }, 'cancel')).not.toThrow();
    }
    expect(codeOf(() => assertMaintenanceAction({ status: 'COMPLETED' }, 'complete'))).toBe(
      ErrorCodes.MAINTENANCE_STATE_CONFLICT,
    );
  });

  it('reschedules only PLANNED jobs', () => {
    expect(() => assertMaintenanceAction({ status: 'PLANNED' }, 'reschedule')).not.toThrow();
    expect(codeOf(() => assertMaintenanceAction({ status: 'IN_PROGRESS' }, 'reschedule'))).toBe(
      ErrorCodes.MAINTENANCE_STATE_CONFLICT,
    );
  });
});

describe('operations-number', () => {
  it('formats expense numbers as EXP-{YYYY}-{6-digit seq}', () => {
    expect(formatOperationsNumber('expense', 1)).toBe('EXP-2026-000001');
    expect(formatOperationsNumber('expense', 123456)).toBe('EXP-2026-123456');
    expect(formatOperationsNumber('expense', 123456789)).toBe('EXP-2026-123456789');
  });
});