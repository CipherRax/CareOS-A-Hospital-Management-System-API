import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Intake readiness (brief §6.15): a branch may only accept anonymous emergency
 * help requests when someone is actually able to receive them.
 *
 * Enabling intake without an escalation chain would mean a caller believes a
 * facility has been alerted when nobody has been paged at all. This is the most
 * dangerous single misconfiguration on the whole surface, so the guard is
 * enforced at three points: enabling the policy, publishing/keeping the public
 * projection flag on, and at submit time (defence in depth for rows written
 * before this guard existed).
 */

export interface ContactReachability {
  /** Enabled at all. */
  active: boolean;
  /** Currently on call, i.e. genuinely reachable. */
  onCall: boolean;
  /** Has a phone line or resolves to a staff user's phone. */
  hasChannel: boolean;
  /** Within their on-call window at the instant readiness is evaluated. */
  onShiftAt?: (at: Date) => boolean;
}

export interface IntakeReadinessInput {
  enabled: boolean;
  autoEscalate: boolean;
  /** Parsed per-level SLA windows. Empty means no chain is configured. */
  levelSeconds: number[];
  contacts: ContactReachability[];
  /**
   * When set, contacts are evaluated at this instant so per-shift on-call windows
   * (§6.15) are honoured: a branch staffed only at night must not be reported as
   * unreachable at 10am purely because nobody is on shift yet. Omitted means "do
   * not apply windows" — used when reporting configuration rather than live
   * reachability.
   */
  at?: Date;
}

export type IntakeReadinessReason =
  | 'NO_ACTIVE_CONTACTS'
  | 'NO_CONTACT_CHANNEL'
  | 'NO_ESCALATION_LEVELS'
  | 'AUTO_ESCALATE_OFF';

export interface IntakeReadiness {
  ready: boolean;
  reasons: IntakeReadinessReason[];
  /** Active + on-call contacts that have a way to be reached. */
  reachableContacts: number;
  /**
   * Contacts that are configured and switched on but are off-shift right now.
   * Reported separately so an operator sees "nobody on shift" rather than the
   * misleading "no contacts configured".
   */
  offShiftContacts: number;
}

const REASON_TEXT: Record<IntakeReadinessReason, string> = {
  NO_ACTIVE_CONTACTS:
    'Add at least one active on-call contact so someone is paged when a request arrives.',
  NO_CONTACT_CHANNEL:
    'Every active contact needs a phone number or a staff user with a phone on file.',
  NO_ESCALATION_LEVELS:
    'Configure at least one escalation level so unanswered requests keep escalating.',
  AUTO_ESCALATE_OFF:
    'Automatic escalation must stay on, otherwise an unanswered request is never escalated.',
};

/**
 * Evaluates whether a branch can safely accept anonymous emergency requests.
 * Readiness only matters when `enabled` is true: a disabled branch is simply
 * closed, not misconfigured.
 *
 * On-call windows deliberately do NOT make a branch unready. Refusing a caller's
 * request because the roster shows nobody on shift would be the most dangerous
 * outcome here: the person needing help would be told to go elsewhere. Windows
 * only decide who gets paged (see domain/on-call-window.ts); the off-shift count
 * is surfaced so an operator can widen the roster.
 */
export function evaluateIntakeReadiness(input: IntakeReadinessInput): IntakeReadiness {
  if (!input.enabled) {
    return { ready: false, reasons: [], reachableContacts: 0, offShiftContacts: 0 };
  }

  const reasons: IntakeReadinessReason[] = [];
  const active = input.contacts.filter((c) => c.active);
  if (active.length === 0) reasons.push('NO_ACTIVE_CONTACTS');

  const reachableContacts = active.filter((c) => c.onCall && c.hasChannel).length;
  if (active.length > 0 && reachableContacts === 0) reasons.push('NO_CONTACT_CHANNEL');

  if (input.levelSeconds.length === 0) reasons.push('NO_ESCALATION_LEVELS');
  if (!input.autoEscalate) reasons.push('AUTO_ESCALATE_OFF');

  return {
    ready: reasons.length === 0,
    reasons,
    reachableContacts,
    offShiftContacts: countOffShift(active, input.at),
  };
}

/**
 * Contacts that are switched on but outside their on-call window right now. Purely
 * informational: a branch with everyone off-shift is still ready to accept a
 * request, it just has nobody to page until the next escalation level.
 */
function countOffShift(contacts: ContactReachability[], at: Date | undefined): number {
  if (!at) return 0;
  return contacts.filter(
    (c) => c.onCall && c.hasChannel && !(c.onShiftAt ? c.onShiftAt(at) : true),
  ).length;
}

/** Operator-facing explanations for each unmet readiness condition. */
export function intakeReadinessMessages(reasons: IntakeReadinessReason[]): string[] {
  return reasons.map((r) => REASON_TEXT[r]);
}

/**
 * Throws when a branch cannot accept anonymous requests. Used by the policy
 * update path and the public submit path.
 */
export function assertIntakeReady(readiness: IntakeReadiness, context: string): void {
  if (readiness.ready) return;
  throw new AppError({
    code: ErrorCodes.EMERGENCY_INTAKE_NOT_READY,
    message: `Emergency intake is not ready for ${context}.`,
    details: { reasons: readiness.reasons, messages: intakeReadinessMessages(readiness.reasons) },
    silent: true,
  });
}