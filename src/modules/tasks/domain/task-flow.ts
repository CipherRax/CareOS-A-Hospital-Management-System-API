import type { TaskStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Task lifecycle (brief Phase 4 §6.6): OPEN → IN_PROGRESS → DONE (or
 * CANCELLED). Terminal states cannot be re-opened; the workflow engine
 * (system ∪ org custom edges) is the central guard.
 */
export type TaskAction = 'start' | 'complete' | 'cancel';

export const TASK_ACTION_TARGETS: Record<TaskAction, TaskStatus> = {
  start: 'IN_PROGRESS',
  complete: 'DONE',
  cancel: 'CANCELLED',
};

const ALLOWED_FROM: Record<TaskAction, readonly TaskStatus[]> = {
  start: ['OPEN'],
  complete: ['OPEN', 'IN_PROGRESS'],
  cancel: ['OPEN', 'IN_PROGRESS'],
};

export function assertTaskAction(current: TaskStatus, action: TaskAction): TaskStatus {
  const allowed = ALLOWED_FROM[action];
  if (!allowed.includes(current)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current} task cannot be ${action === 'start' ? 'started' : `${action}ed`}.`,
      silent: true,
    });
  }
  if (current === TASK_ACTION_TARGETS[action]) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: 'The task is already in that status.',
      silent: true,
    });
  }
  return TASK_ACTION_TARGETS[action];
}