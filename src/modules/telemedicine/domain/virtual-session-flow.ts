import type { VirtualSessionStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

export const VIRTUAL_SESSION_TRANSITIONS: Record<
  VirtualSessionStatus,
  readonly VirtualSessionStatus[]
> = {
  SCHEDULED: ['STARTED', 'CANCELLED'],
  STARTED: ['ENDED'],
  ENDED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const TRANSITIONS = VIRTUAL_SESSION_TRANSITIONS;

export function assertTransition(
  current: VirtualSessionStatus,
  next: VirtualSessionStatus,
): void {
  if (VIRTUAL_SESSION_TRANSITIONS[current]?.includes(next)) return;
  throw new AppError({
    code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
    message: `Virtual session cannot move from ${current} to ${next}.`,
    silent: true,
  });
}

export interface CanStartInput {
  status: VirtualSessionStatus;
  consentRecorded: boolean;
  scheduledStartAt: Date;
  now: Date;
}

export function canStart(input: CanStartInput): boolean {
  return input.status === 'SCHEDULED' && input.consentRecorded;
}
