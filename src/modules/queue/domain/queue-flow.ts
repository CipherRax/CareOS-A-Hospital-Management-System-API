import type { QueueStatus, VisitStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Queue lifecycle (brief §6.5). A ticket walks WAITING → CALLED → IN_SERVICE →
 * COMPLETED; NO_SHOW / ABANDONED / CANCELLED / TRANSFERRED are the negative
 * exits. TRANSFERRED marks the leaving entry when it moves to another
 * department (a fresh WAITING entry is created at the target).
 */

export const QUEUE_TRANSITIONS: Record<QueueStatus, readonly QueueStatus[]> = {
  WAITING: ['CALLED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED'],
  CALLED: ['IN_SERVICE', 'WAITING', 'NO_SHOW', 'CANCELLED', 'TRANSFERRED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED', 'TRANSFERRED'],
  COMPLETED: [],
  NO_SHOW: [],
  ABANDONED: [],
  CANCELLED: [],
  TRANSFERRED: [],
};

/** Statuses that consume the patient's turn (still in front of the desk). */
export const ACTIVE_QUEUE_STATUSES: ReadonlySet<QueueStatus> = new Set([
  'WAITING',
  'CALLED',
  'IN_SERVICE',
]);

export function assertQueueTransition(from: QueueStatus, to: QueueStatus): void {
  if (from === to) return;
  if (!QUEUE_TRANSITIONS[from].includes(to)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `Queue entry cannot move from ${from} to ${to}.`,
      silent: true,
    });
  }
}

/**
 * Visit journey states (brief §6.5): Reception → Triage → Doctor → Laboratory
 * → Pharmacy → Billing, modelled explicitly. Only forward moves are legal;
 * the linear path is implied but department hops (e.g. LAB → CONSULTATION)
 * are permitted so the desk can send a patient back to the clinician.
 */

export const VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  REGISTERED: ['CHECKED_IN'],
  CHECKED_IN: ['WAITING', 'TRIAGE', 'WAITING_FOR_PROVIDER', 'CONSULTATION', 'COMPLETED'],
  WAITING: ['TRIAGE', 'WAITING_FOR_PROVIDER', 'CONSULTATION', 'COMPLETED'],
  TRIAGE: ['WAITING_FOR_PROVIDER', 'CONSULTATION', 'WAITING'],
  WAITING_FOR_PROVIDER: ['CONSULTATION', 'LAB', 'RADIOLOGY', 'PHARMACY', 'BILLING', 'COMPLETED'],
  CONSULTATION: ['LAB', 'RADIOLOGY', 'PHARMACY', 'BILLING', 'COMPLETED', 'WAITING'],
  LAB: ['WAITING_FOR_PROVIDER', 'CONSULTATION', 'BILLING', 'COMPLETED', 'PHARMACY'],
  RADIOLOGY: ['WAITING_FOR_PROVIDER', 'CONSULTATION', 'BILLING', 'COMPLETED'],
  PHARMACY: ['BILLING', 'COMPLETED'],
  BILLING: ['COMPLETED'],
  COMPLETED: [],
};

export function assertVisitTransition(from: VisitStatus, to: VisitStatus): void {
  if (from === to) return;
  if (!VISIT_TRANSITIONS[from].includes(to)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `Visit cannot move from ${from} to ${to}.`,
      silent: true,
    });
  }
}