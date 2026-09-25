import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

export type AdmissionAction = 'discharge';

/**
 * The admission workflow target for an action. Bed transfers do NOT change the
 * admission status — they move the active BedAssignment inside the ADMITTED
 * state, so history is preserved on the assignment rows.
 */
export function assertAdmissionAction(
  from: string,
  action: AdmissionAction,
): 'DISCHARGED' {
  const target =
    action === 'discharge' && from === 'ADMITTED' ? 'DISCHARGED' : undefined;
  if (!target) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `An ${from} admission cannot be ${action}ed.`,
      silent: true,
    });
  }
  return target;
}

/** Statuses an operator may set directly (OCCUPIED is assignment-driven). */
export const MANUAL_BED_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'CLEANING',
  'MAINTENANCE',
  'BLOCKED',
] as const;

export type ManualBedStatus = (typeof MANUAL_BED_STATUSES)[number];

export function isManualBedStatus(value: string): value is ManualBedStatus {
  return (MANUAL_BED_STATUSES as readonly string[]).includes(value);
}

export function assertManualBedStatus(value: string): ManualBedStatus {
  if (!isManualBedStatus(value)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message:
        "Bed status must be AVAILABLE, RESERVED, CLEANING, MAINTENANCE or BLOCKED. OCCUPIED is assigned by the system when a patient is admitted.",
      silent: true,
    });
  }
  return value;
}

export function bedUnavailable(message: string): AppError {
  return new AppError({
    code: ErrorCodes.BED_UNAVAILABLE,
    message,
    silent: true,
  });
}