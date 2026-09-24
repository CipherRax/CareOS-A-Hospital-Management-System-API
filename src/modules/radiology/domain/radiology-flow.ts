import type { RadiologyOrder, RadiologyOrderStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Radiology lifecycle core (brief §6.8, radiology). The `RadiologyOrder` is the
 * workflow aggregate; explicit actions (schedule/perform/report/verify/release/
 * cancel) are validated here as a pure map and asserted again against the
 * org-customizable workflow engine by the service. The 1:1 ImagingReport lives
 * alongside the order and is required before a report can be verified.
 */

export type RadiologyAction =
  | 'schedule'
  | 'perform'
  | 'report'
  | 'verify'
  | 'release'
  | 'cancel';

const RAD_ALLOWED_FROM: Record<RadiologyAction, readonly RadiologyOrderStatus[]> = {
  schedule: ['ORDERED'],
  perform: ['SCHEDULED'],
  report: ['PERFORMED'],
  verify: ['REPORTED'],
  release: ['VERIFIED'],
  cancel: ['ORDERED', 'SCHEDULED'],
};

const RAD_TARGET: Record<RadiologyAction, RadiologyOrderStatus> = {
  schedule: 'SCHEDULED',
  perform: 'PERFORMED',
  report: 'REPORTED',
  verify: 'VERIFIED',
  release: 'RELEASED',
  cancel: 'CANCELLED',
};

/** Returns the target status for an action, else throws the workflow error. */
export function assertRadiologyAction(
  current: Pick<RadiologyOrder, 'status'>,
  action: RadiologyAction,
): RadiologyOrderStatus {
  const allowed = RAD_ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} radiology order cannot be ${action}d.`,
      silent: true,
    });
  }
  return RAD_TARGET[action];
}