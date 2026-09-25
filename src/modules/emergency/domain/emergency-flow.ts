import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

export type EmergencyAction =
  | 'triage'
  | 'assess'
  | 'treat'
  | 'observe'
  | 'admit'
  | 'refer'
  | 'discharge';

export type EmergencyVisitStatus =
  | 'ARRIVED'
  | 'TRIAGED'
  | 'ASSESSED'
  | 'IN_TREATMENT'
  | 'OBSERVATION'
  | 'DISCHARGED'
  | 'ADMITTED'
  | 'REFERRED';

/** Every status reachable by a user action — cheap Exclude of ARRIVED. */
export type EmergencyTargetStatus = Exclude<EmergencyVisitStatus, 'ARRIVED'>;

/** Source statuses from which each action is legal (brief §6.9). */
export const EMERGENCY_SOURCES: Record<EmergencyAction, readonly EmergencyVisitStatus[]> = {
  triage: ['ARRIVED'],
  assess: ['TRIAGED'],
  treat: ['ASSESSED'],
  observe: ['ASSESSED', 'IN_TREATMENT'],
  admit: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
  refer: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
  discharge: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
};

export const EMERGENCY_TARGET: Record<EmergencyAction, EmergencyTargetStatus> = {
  triage: 'TRIAGED',
  assess: 'ASSESSED',
  treat: 'IN_TREATMENT',
  observe: 'OBSERVATION',
  admit: 'ADMITTED',
  refer: 'REFERRED',
  discharge: 'DISCHARGED',
};

/**
 * Emergency department workflow (brief §6.9):
 * ARRIVED → (triage) → TRIAGED → (assess) → ASSESSED →
 *   (treat) → IN_TREATMENT → (observe) → OBSERVATION →
 *   (admit | refer | discharge). The central workflow map in workflow-core is
 *   enforced by WorkflowsService; this pure function derives the target status.
 */
export function assertEmergencyAction(from: EmergencyVisitStatus, action: EmergencyAction): EmergencyTargetStatus {
  if (!EMERGENCY_SOURCES[action].includes(from)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `An ${from} emergency visit cannot be ${action}ed.`,
      silent: true,
    });
  }
  return EMERGENCY_TARGET[action];
}

export const EMERGENCY_TERMINAL_STATUSES: readonly EmergencyTargetStatus[] = [
  'DISCHARGED',
  'ADMITTED',
  'REFERRED',
];

export function isEmergencyTerminal(status: string): boolean {
  return (EMERGENCY_TERMINAL_STATUSES as readonly string[]).includes(status);
}