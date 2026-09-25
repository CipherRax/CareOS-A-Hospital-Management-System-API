import type {
  ComplaintStatus,
  FeedbackStatus,
  IncidentStatus,
} from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Quality lifecycle state machines (brief Phase 10). Pure, unit-testable
 * transition tables + data-rule guards. Services read the current row first,
 * run these assertions, and only then apply the transition inside a transaction.
 *
 * Same-status patches are no-ops (allowed) so that idempotent clients may
 * re-apply a status without tripping the machine.
 */

export const FEEDBACK_TRANSITIONS: Record<
  FeedbackStatus,
  readonly FeedbackStatus[]
> = {
  NEW: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

export const COMPLAINT_TRANSITIONS: Record<
  ComplaintStatus,
  readonly ComplaintStatus[]
> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

export const INCIDENT_TRANSITIONS: Record<
  IncidentStatus,
  readonly IncidentStatus[]
> = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['ACTION_PLAN'],
  ACTION_PLAN: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

/**
 * A complaint may only be (re)assigned while it is ASSIGNED or INVESTIGATING.
 * Creating a complaint with an assignee opens at ASSIGNED (see service), so the
 * invariant "assignment implies ASSIGNED/INVESTIGATING" always holds.
 */
export const COMPLAINT_ASSIGNABLE_STATUSES: ReadonlySet<ComplaintStatus> =
  new Set(['ASSIGNED', 'INVESTIGATING']);

function transitionError(from: string, to: string): AppError {
  return new AppError({
    code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
    message: `Invalid workflow transition: ${from} → ${to}.`,
    silent: true,
  });
}

function ruleError(message: string): AppError {
  return new AppError({
    code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
    message,
    silent: true,
  });
}

export function assertFeedbackTransition(
  current: FeedbackStatus,
  next: FeedbackStatus,
): void {
  if (current === next) return;
  if (!FEEDBACK_TRANSITIONS[current].includes(next)) {
    throw transitionError(current, next);
  }
}

export function assertComplaintTransition(
  current: ComplaintStatus,
  next: ComplaintStatus,
): void {
  if (current === next) return;
  if (!COMPLAINT_TRANSITIONS[current].includes(next)) {
    throw transitionError(current, next);
  }
}

export function assertIncidentTransition(
  current: IncidentStatus,
  next: IncidentStatus,
): void {
  if (current === next) return;
  if (!INCIDENT_TRANSITIONS[current].includes(next)) {
    throw transitionError(current, next);
  }
}

export interface FeedbackRespondSpec {
  current: FeedbackStatus;
  next: FeedbackStatus;
  /** Newly submitted response text (if any). */
  response?: string | null;
  /** Response already stored on the record. */
  existingResponse?: string | null;
}

/**
 * Feedback may only leave NEW when a response is recorded. The stored response
 * is accepted as satisfying the rule when the caller only re-states the status.
 */
export function assertFeedbackRespondRules(spec: FeedbackRespondSpec): void {
  assertFeedbackTransition(spec.current, spec.next);
  if (spec.next === 'NEW') return;
  const effective = spec.response ?? spec.existingResponse ?? '';
  if (effective.trim().length === 0) {
    throw ruleError('Feedback cannot move out of NEW without a response.');
  }
}

/**
 * A complaint cannot be closed without a resolution. The effective resolution
 * is the newly provided one (if any) falling back to the stored one, so a
 * complaint already RESOLVED with a resolution may be closed as-is.
 */
export function assertComplaintClosure(
  current: ComplaintStatus,
  next: ComplaintStatus,
  resolution: string | null | undefined,
): void {
  if (current === next) return;
  assertComplaintTransition(current, next);
  if (next === 'CLOSED' && (!resolution || resolution.trim().length === 0)) {
    throw ruleError('A complaint cannot be closed without a resolution.');
  }
}

/** Assignment data may only be applied while the complaint is ASSIGNED or INVESTIGATING. */
export function assertComplaintAssignmentAllowed(
  next: ComplaintStatus,
): void {
  if (!COMPLAINT_ASSIGNABLE_STATUSES.has(next)) {
    throw ruleError(
      'A complaint may only be assigned while it is ASSIGNED or INVESTIGATING.',
    );
  }
}