import type { MaintenanceRecord } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Maintenance lifecycle (brief Phase 10 §7.11). A record is PLANNED when
 * scheduled, moves to IN_PROGRESS when work starts, then COMPLETED (a history
 * row with downtime/cost) or CANCELLED. An asset in MAINTENANCE status cannot
 * spawn new work; only ACTIVE assets do.
 */

export type MaintenanceAction = 'reschedule' | 'start' | 'complete' | 'cancel';

export function assertMaintenanceAction(
  record: Pick<MaintenanceRecord, 'status'>,
  action: MaintenanceAction,
): void {
  switch (action) {
    case 'reschedule':
      if (record.status !== 'PLANNED') {
        throw stateConflict(`Cannot reschedule a maintenance record in ${record.status} state.`);
      }
      return;
    case 'start':
      if (record.status !== 'PLANNED') {
        throw stateConflict(`Cannot start a maintenance record in ${record.status} state.`);
      }
      return;
    case 'complete':
      if (record.status !== 'PLANNED' && record.status !== 'IN_PROGRESS') {
        throw stateConflict(`Cannot complete a maintenance record in ${record.status} state.`);
      }
      return;
    case 'cancel':
      if (record.status !== 'PLANNED' && record.status !== 'IN_PROGRESS') {
        throw stateConflict(`Cannot cancel a maintenance record in ${record.status} state.`);
      }
      return;
  }
}

function stateConflict(message: string): AppError {
  return new AppError({
    code: ErrorCodes.MAINTENANCE_STATE_CONFLICT,
    message,
    silent: true,
  });
}