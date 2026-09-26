import type { Expense } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Expense approval workflow (brief Phase 10 §7.11). The lifecycle is
 * DRAFT → SUBMITTED → APPROVED (or REJECTED / CANCELLED); an approved expense
 * then moves UNPAID → PAID. Approving a document you created is a segregation
 * violation (SEGREGATION_VIOLATION) — the approver must be a different user
 * than the creator. Once APPROVED the expense is a ledger obligation and can
 * no longer be cancelled (the reversal path is the ledger itself, ADR-035).
 *
 * Money validation happens in the DTO; this module owns state transitions only.
 */

export type ExpenseAction = 'update' | 'submit' | 'approve' | 'reject' | 'pay' | 'cancel';

export function assertExpenseAction(
  expense: Pick<Expense, 'status' | 'paymentStatus' | 'createdById'>,
  action: ExpenseAction,
  actorId: string,
  rejectReason?: string,
): void {
  switch (action) {
    case 'update':
      if (expense.status !== 'DRAFT') {
        throw stateConflict(`Expenses can only be edited while DRAFT (status is ${expense.status}).`);
      }
      return;
    case 'submit':
      if (expense.status !== 'DRAFT') {
        throw stateConflict(`Cannot submit an expense in ${expense.status} state.`);
      }
      return;
    case 'approve':
      if (expense.status !== 'SUBMITTED') {
        throw stateConflict(`Cannot approve an expense in ${expense.status} state.`);
      }
      assertSegregation(expense, actorId, 'approve');
      return;
    case 'reject':
      if (expense.status !== 'SUBMITTED') {
        throw stateConflict(`Cannot reject an expense in ${expense.status} state.`);
      }
      if (!rejectReason?.trim()) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'A reject reason is required.',
          silent: true,
        });
      }
      assertSegregation(expense, actorId, 'reject');
      return;
    case 'pay':
      if (expense.status !== 'APPROVED') {
        throw stateConflict(`Only APPROVED expenses can be paid (status is ${expense.status}).`);
      }
      if (expense.paymentStatus === 'PAID') {
        throw new AppError({
          code: ErrorCodes.EXPENSE_ALREADY_PAID,
          message: 'This expense is already paid.',
          silent: true,
        });
      }
      return;
    case 'cancel':
      if (expense.status !== 'DRAFT' && expense.status !== 'SUBMITTED') {
        throw stateConflict(`An expense in ${expense.status} state cannot be cancelled.`);
      }
      return;
  }
}

/** An approver/rejecter may not be the person who created the expense. */
function assertSegregation(
  expense: Pick<Expense, 'createdById' | 'status'>,
  actorId: string,
  action: string,
): void {
  if (expense.createdById === actorId) {
    throw new AppError({
      code: ErrorCodes.SEGREGATION_VIOLATION,
      message: `The ${action}r cannot be the expense creator (segregation of duties).`,
      silent: true,
    });
  }
}

function stateConflict(message: string): AppError {
  return new AppError({
    code: ErrorCodes.EXPENSE_STATE_CONFLICT,
    message,
    silent: true,
  });
}