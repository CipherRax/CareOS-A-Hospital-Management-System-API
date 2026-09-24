import type { Prescription, PrescriptionStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Prescription lifecycle (brief Phase 5 §7.5): DRAFT → ISSUED → PARTIALLY
 * DISPENSED → DISPENSED (or CANCELLED while the drug is still un- or
 * partially-dispensed). The workflow engine complements this with the org's
 * custom edges; terminal DISPENSED cannot be re-opened.
 */
export type PrescriptionAction = 'issue' | 'cancel' | 'dispense';

export type PrescriptionStatusUpdate =
  | { status: 'ISSUED'; issuedById: string; issuedAt: Date }
  | { status: 'PARTIALLY_DISPENSED' }
  | { status: 'DISPENSED'; dispensedAt: Date }
  | { status: 'CANCELLED'; cancelledById: string; cancelledAt: Date; cancelReason?: string };

const ALLOWED_FROM: Record<PrescriptionAction, readonly PrescriptionStatus[]> = {
  issue: ['DRAFT'],
  cancel: ['DRAFT', 'ISSUED', 'PARTIALLY_DISPENSED'],
  // A dispense step can move a fully-dispensed prescription forward (re-issuing)
  // but never backwards.
  dispense: ['ISSUED', 'PARTIALLY_DISPENSED'],
};

export function assertPrescriptionAction(
  current: Pick<Prescription, 'status'>,
  action: PrescriptionAction,
): void {
  const allowed = ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} prescription cannot be ${action}ed.`,
      silent: true,
    });
  }
}

/** Target status after an issue/cancel/complete-dispense step. */
export function prescriptionTargetStatus(
  action: PrescriptionAction,
): PrescriptionStatus {
  switch (action) {
    case 'issue':
      return 'ISSUED';
    case 'cancel':
      return 'CANCELLED';
    case 'dispense':
      return 'DISPENSED';
  }
}

/** Derive the post-dispense status from cumulative dispensed quantity. */
export function statusAfterDispense(
  requestedTotal: number,
  dispensedTotal: number,
): 'DISPENSED' | 'PARTIALLY_DISPENSED' {
  return dispensedTotal >= requestedTotal ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
}