import type {
  LabOrder,
  LabOrderStatus,
  LabSampleStatus,
  LabTestField,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Laboratory lifecycle core (brief Phase 6).
 *
 * The `LabOrder` status machine is the workflow aggregate; explicit actions
 * (collect/receive/process/reject/cancel/verify/release) are validated here as
 * a pure map and then asserted again against org-customizable workflows by the
 * service (custom edges can only widen). The physical `LabSample` mirrors the
 * order through `sampleStatusForOrder` and both are updated in the same
 * transaction, so they can never drift.
 *
 * Result flags (abnormal/critical) are computed by PURE functions from the
 * org-configured reference/critical ranges stored on LabTestField — there are
 * no hard-coded thresholds anywhere.
 */

export type LabAction =
  | 'collect'
  | 'receive'
  | 'process'
  | 'enter_results'
  | 'reject'
  | 'cancel'
  | 'verify'
  | 'release';

const LAB_ALLOWED_FROM: Record<LabAction, readonly LabOrderStatus[]> = {
  collect: ['ORDERED'],
  receive: ['COLLECTED'],
  process: ['RECEIVED'],
  enter_results: ['PROCESSING'],
  reject: ['COLLECTED', 'RECEIVED'],
  cancel: ['ORDERED', 'COLLECTED'],
  verify: ['RESULT_READY'],
  release: ['VERIFIED'],
};

const LAB_TARGET: Record<LabAction, LabOrderStatus> = {
  collect: 'COLLECTED',
  receive: 'RECEIVED',
  process: 'PROCESSING',
  enter_results: 'RESULT_READY',
  reject: 'REJECTED',
  cancel: 'CANCELLED',
  verify: 'VERIFIED',
  release: 'RELEASED',
};

/**
 * Returns the target status for a lifecycle action, throwing
 * INVALID_WORKFLOW_TRANSITION when the order is not in an allowed starting
 * state. The service additionally funnels the move through the workflow
 * engine so org customizations apply.
 */
export function assertLabAction(
  current: Pick<LabOrder, 'status'>,
  action: LabAction,
): LabOrderStatus {
  const allowed = LAB_ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${current.status} lab order cannot be ${action.replace('_', ' ')}d.`,
      silent: true,
    });
  }
  return LAB_TARGET[action];
}

/** Explicit guard for the brief rule "lab results cannot be released without required verification". */
export function assertOrderVerifiedForRelease(
  current: Pick<LabOrder, 'status'>,
): void {
  if (current.status !== 'VERIFIED') {
    throw new AppError({
      code: ErrorCodes.LAB_RESULT_NOT_VERIFIED,
      message: 'Lab results cannot be released until they have been verified.',
      silent: true,
    });
  }
}

/**
 * The physical sample's status for a given order status. Kept in lock-step by
 * updating the sample in the same transaction as the order transition. A
 * CANCELLED order leaves the (never-processed) sample inert at ORDERED, which
 * reads as "not collected" rather than implying the specimen was rejected.
 */
export function sampleStatusForOrder(status: LabOrderStatus): LabSampleStatus {
  switch (status) {
    case 'ORDERED':
      return 'ORDERED';
    case 'COLLECTED':
      return 'COLLECTED';
    case 'RECEIVED':
      return 'RECEIVED';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'RESULT_READY':
    case 'VERIFIED':
    case 'RELEASED':
      return 'COMPLETED';
    case 'REJECTED':
      return 'REJECTED';
    case 'CANCELLED':
      return 'ORDERED';
  }
}

/**
 * Validates a submitted result value against the configured field type.
 * NUMERIC must parse as a finite decimal; TEXT/CATEGORICAL with a configured
 * allowsValues list must be one of the allowed values.
 */
export function assertFieldValue(
  field: Pick<LabTestField, 'name' | 'fieldType' | 'allowsValues'>,
  value: string,
): void {
  if (value.trim().length === 0) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: `A result value is required for field "${field.name}".`,
      silent: true,
    });
  }
  if (field.fieldType === 'NUMERIC') {
    const n = Number(value);
    if (Number.isNaN(n) || !Number.isFinite(n)) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `"${value}" is not a valid numeric result for field "${field.name}".`,
        silent: true,
      });
    }
    return;
  }
  if (field.allowsValues) {
    const allowed = field.allowsValues.split(',').map((v) => v.trim());
    if (!allowed.includes(value.trim())) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `"${value}" is not one of the allowed values for field "${field.name}".`,
        silent: true,
      });
    }
  }
}

/**
 * Flags a result from the org-configured ranges ONLY: abnormal when outside
 * the (referenceMin, referenceMax) window, critical when beyond the critical
 * thresholds. Absent limits mean nothing is flagged. Non-numeric fields never
 * flag (their abnormal/critical flags must be set by a verified reviewer).
 */
export function classifyFieldValue(
  field: Pick<LabTestField, 'fieldType' | 'referenceMin' | 'referenceMax' | 'criticalMin' | 'criticalMax'>,
  value: string,
): { isAbnormal: boolean; isCritical: boolean } {
  if (field.fieldType !== 'NUMERIC') return { isAbnormal: false, isCritical: false };
  let n: Prisma.Decimal;
  try {
    n = new Prisma.Decimal(value);
  } catch {
    return { isAbnormal: false, isCritical: false };
  }
  const within = (min: Prisma.Decimal | null, max: Prisma.Decimal | null): boolean => {
    const lo = min === null || n.greaterThanOrEqualTo(min);
    const hi = max === null || n.lessThanOrEqualTo(max);
    return lo && hi;
  };
  const isCritical = !within(field.criticalMin ?? null, field.criticalMax ?? null);
  const isAbnormal = !within(field.referenceMin ?? null, field.referenceMax ?? null);
  return { isAbnormal, isCritical };
}

/** Turnaround time (minutes) from sample collection to result release. */
export function computeTurnaroundMinutes(
  collectedAt: Date,
  releasedAt: Date,
): number {
  const ms = releasedAt.getTime() - collectedAt.getTime();
  return Math.round(ms / 60_000);
}