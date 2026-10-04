import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';
import { defaultNumbersFor, type NationalEmergencyNumber } from './numbers';
import { EMERGENCY_DISCLOSURE } from './consent';

export type EmergencyCallerAction = 'WAIT' | 'CALL_NOW' | 'HELP_ON_WAY';

const ACTION_MESSAGE: Record<EmergencyCallerAction, string> = {
  WAIT:
    'We have notified the facility. Keep this token to check again as your request advances.',
  CALL_NOW:
    'No responder has confirmed this request yet. Call the facility or your national emergency number right now.',
  HELP_ON_WAY:
    'A response team has taken this request. Stay where you are and keep your phone ready.',
};

/** Caller-safe rendering of a request status. Never leaks internal detail. */
const STATUS_LABEL: Record<string, string> = {
  RECEIVED: 'Received',
  ACKNOWLEDGED: 'Seen by the facility',
  CONTACTED: 'Facility tried to contact you',
  RESPONDING: 'Response team assigned',
  ESCALATED: 'Escalated to a supervisor',
  REDIRECTED: 'Redirected',
  UNREACHABLE: 'Facility could not reach you',
  DUPLICATE: 'Duplicate of another request',
  NOT_ACTIONABLE: 'Closed as not actionable',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/**
 * Statuses where the facility is finished with the request. Distinct from the
 * retention sweep's reapable set (CLOSED/CANCELLED with a close timestamp),
 * because some of these are finished without ever having a close stamp — but all
 * of them must stop lifecycle transitions and stop the escalation chain.
 */
const TERMINAL_STATUSES = new Set([
  'CLOSED',
  'CANCELLED',
  'NOT_ACTIONABLE',
  'UNREACHABLE',
  'REDIRECTED',
  'DUPLICATE',
]);

/** Statuses that still need a human to act on them. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Statuses the escalation chain must stop on. A redirected, unreachable,
 * not-actionable, or duplicate request is finished for escalation purposes;
 * ESCALATED stays in the list because each level flips the read model to it.
 */
export function stopsEscalation(status: string): boolean {
  return status !== 'RECEIVED' && status !== 'ESCALATED';
}

/**
 * Caller-facing guidance derived from the request read model. ADR-040: only a
 * staff-set RESPONDING implies help is coming; everything short of that while
 * the final escalation level is reached is CALL_NOW.
 *
 * A caller who could not be reached, or whose request was closed without
 * action, must not be told to keep waiting — the safe action is to call.
 */
export function callerAction(request: {
  status: string;
  escalationLevel: number;
  acknowledgedAt: Date | null;
  respondedAt: Date | null;
}): EmergencyCallerAction {
  if (request.respondedAt) return 'HELP_ON_WAY';
  if (request.status === 'CANCELLED' || request.status === 'CLOSED') return 'WAIT';
  // Nothing further will happen on our side, and we have not confirmed anyone
  // is coming: the only remaining safe action is a phone call.
  if (request.status === 'UNREACHABLE' || request.status === 'NOT_ACTIONABLE') return 'CALL_NOW';
  if (request.status === 'DUPLICATE') return 'CALL_NOW';
  // A staff member has the caller on the line: a human is engaged, so there is
  // nothing for the caller to do but stay reachable. Escalation state is
  // irrelevant once someone has spoken to them.
  if (request.status === 'CONTACTED') return 'WAIT';
  if (request.acknowledgedAt) return 'WAIT';
  if (request.escalationLevel > 0) return 'CALL_NOW';
  return 'WAIT';
}

/** Human-readable, caller-safe status label. */
export function callerStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? 'Received';
}

/** Message text for a caller action. */
export function callerActionMessage(action: EmergencyCallerAction): string {
  return ACTION_MESSAGE[action];
}

/**
 * National emergency numbers attached to every caller-facing response, including
 * rate-limit rejections and "not accepting requests" errors. These are the one
 * payload we can always fall back on when the platform refuses or delays.
 */
export function emergencyNumbersPayload(
  numbers: readonly NationalEmergencyNumber[] = defaultNumbersFor('KE'),
): Array<{ purpose: string; label: string; phone: string; hours: string | null }> {
  return numbers.map((n) => ({
    purpose: n.purpose,
    label: n.label,
    phone: n.phone,
    hours: n.hours ?? null,
  }));
}

/** The standing disclaimer. Every caller-facing payload carries it. */
export const EMERGENCY_DISCLAIMER = 'careOS does not dispatch emergency services or guarantee a response time.';

/**
 * Builds the `EMERGENCY_CALL_NOW` error thrown whenever we cannot accept or
 * continue a request. Always includes the caller's next best action and the
 * national numbers, so no failure path leaves a caller without a phone number.
 */
export function emergencyCallNowError(options: {
  message: string;
  numbers?: readonly NationalEmergencyNumber[];
  details?: Record<string, unknown>;
}): AppError {
  return new AppError({
    code: ErrorCodes.EMERGENCY_CALL_NOW,
    message: options.message,
    details: {
      action: 'CALL_NOW',
      numbers: emergencyNumbersPayload(options.numbers),
      disclosure: EMERGENCY_DISCLOSURE,
      disclaimer: EMERGENCY_DISCLAIMER,
      ...options.details,
    },
    silent: true,
  });
}