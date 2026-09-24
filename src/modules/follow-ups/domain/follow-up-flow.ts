import type { FollowUp, FollowUpStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Follow-up lifecycle (brief Phase 4 §6.6): SCHEDULED → (REMINDED) →
 * COMPLETED / MISSED / CANCELLED. Reminder/missed handling is owned by the
 * background-jobs phase; today's user actions are complete/cancel, both allowed
 * from SCHEDULED or REMINDED. The workflow engine is enforced in the service.
 */
export type FollowUpAction = 'complete' | 'cancel';

export const FOLLOW_UP_ACTION_TARGETS: Record<FollowUpAction, FollowUpStatus> = {
  complete: 'COMPLETED',
  cancel: 'CANCELLED',
};

export function assertFollowUpAction(current: Pick<FollowUp, 'status'>): FollowUpAction {
  if (current.status !== 'SCHEDULED' && current.status !== 'REMINDED') {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} follow-up cannot be actioned.`,
      silent: true,
    });
  }
  return 'complete';
}

/**
 * Returns the status a user action maps to, or throws if the follow-up is in a
 * terminal state (COMPLETED / MISSED / CANCELLED).
 */
export function targetStatusForAction(
  current: Pick<FollowUp, 'status'>,
  action: FollowUpAction,
): FollowUpStatus {
  assertFollowUpAction(current);
  return FOLLOW_UP_ACTION_TARGETS[action];
}