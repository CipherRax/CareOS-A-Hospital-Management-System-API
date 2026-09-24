import type { Referral, ReferralStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Referral lifecycle (brief Phase 4 §6.6): CREATED → SENT → ACCEPTED →
 * COMPLETED (or REJECTED / CANCELLED). Which actions are legal depends on the
 * current status; terminal states (REJECTED / CANCELLED) can never be
 * re-opened. The workflow engine complements this with the org's custom edges.
 */
export type ReferralAction = 'send' | 'accept' | 'reject' | 'complete' | 'cancel';

export const REFERRAL_ACTION_TARGETS: Record<ReferralAction, ReferralStatus> = {
  send: 'SENT',
  accept: 'ACCEPTED',
  reject: 'REJECTED',
  complete: 'COMPLETED',
  cancel: 'CANCELLED',
};

const ALLOWED_FROM: Record<ReferralAction, readonly ReferralStatus[]> = {
  send: ['CREATED'],
  accept: ['SENT'],
  reject: ['SENT'],
  complete: ['ACCEPTED'],
  cancel: ['CREATED', 'SENT'],
};

export function assertReferralAction(
  current: Pick<Referral, 'status'>,
  action: ReferralAction,
): ReferralStatus {
  const allowed = ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} referral cannot be ${action}ed.`,
      silent: true,
    });
  }
  return REFERRAL_ACTION_TARGETS[action];
}