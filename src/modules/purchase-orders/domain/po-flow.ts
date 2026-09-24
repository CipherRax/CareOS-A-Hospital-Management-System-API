import type { PurchaseOrder, PurchaseOrderStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Purchase order lifecycle (brief Phase 5 §7.3): DRAFT → SUBMITTED → APPROVED →
 * ORDERED → PARTIALLY_RECEIVED → RECEIVED → CLOSED (or CANCELLED from any
 * pre-receipt state). The workflow engine complements this with org custom
 * edges; CLOSED and CANCELLED are terminal.
 */
export type PurchaseOrderAction = 'submit' | 'approve' | 'order' | 'receive' | 'close';

export type PurchaseOrderStateTransition =
  | { status: 'SUBMITTED'; submittedById: string; submittedAt: Date }
  | { status: 'APPROVED'; approvedById: string; approvedAt: Date }
  | { status: 'ORDERED' }
  | { status: 'PARTIALLY_RECEIVED' | 'RECEIVED'; receivedAt: Date }
  | { status: 'CLOSED'; closedAt: Date };

const ALLOWED_FROM: Record<PurchaseOrderAction, readonly PurchaseOrderStatus[]> = {
  submit: ['DRAFT'],
  approve: ['SUBMITTED'],
  order: ['APPROVED'],
  receive: ['ORDERED', 'PARTIALLY_RECEIVED'],
  close: ['RECEIVED'],
};

const TARGET: Record<PurchaseOrderAction, PurchaseOrderStatus> = {
  submit: 'SUBMITTED',
  approve: 'APPROVED',
  order: 'ORDERED',
  receive: 'RECEIVED',
  close: 'CLOSED',
};

export function assertPurchaseOrderAction(
  current: Pick<PurchaseOrder, 'status'>,
  action: PurchaseOrderAction,
): PurchaseOrderStatus {
  const allowed = ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} purchase order cannot be ${action}ed.`,
      silent: true,
    });
  }
  return TARGET[action];
}

/** Effective PO status after a receive step given remaining outstanding qty. */
export function receiveStateAfterStep(
  isFullyReceived: boolean,
): PurchaseOrderStatus {
  return isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
}