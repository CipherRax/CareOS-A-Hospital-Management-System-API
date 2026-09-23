import type { AppointmentStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Appointment lifecycle (brief §6.4). Happy path:
 *
 *   BOOKED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED
 *
 * With impermissible escapes to CANCELLED / NO_SHOW and the RESCHEDULED marker
 * (set only by the reschedule flow, never by the generic transition API).
 * A cancelled or no-show appointment can never be checked in again.
 */

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  BOOKED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

export const TERMINAL_APPOINTMENT_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);

/** Throws INVALID_WORKFLOW_TRANSITION when the move is not allowed. */
export function assertAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): void {
  if (from === to) return;
  if (!APPOINTMENT_TRANSITIONS[from].includes(to)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `Appointment cannot move from ${from} to ${to}.`,
      silent: true,
    });
  }
}