import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';
import type { EncounterStatus } from '@prisma/client';

/**
 * Encounter lifecycle (brief §6.6): OPEN → IN_PROGRESS → COMPLETED. The edge
 * set itself (system ∪ org-custom) is validated centrally by the workflow
 * engine; this guard is the module-level safety rail: a COMPLETED encounter is
 * a hard lock no workflow configuration can reopen. Clinical entries (notes,
 * diagnoses, follow-ups) additionally require an OPEN / IN_PROGRESS encounter.
 */
export const ENCOUNTER_TERMINAL_STATUSES: ReadonlySet<EncounterStatus> = new Set([
  'COMPLETED',
]);

export function assertEncounterTransition(from: EncounterStatus, to: EncounterStatus): void {
  if (from === to) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: 'The encounter is already in that status.',
      silent: true,
    });
  }
  if (ENCOUNTER_TERMINAL_STATUSES.has(from)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: 'A COMPLETED encounter is locked and cannot change status.',
      silent: true,
    });
  }
}

export function assertEncounterOpen(status: EncounterStatus): void {
  if (status !== 'OPEN' && status !== 'IN_PROGRESS') {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: 'Clinical entries can only be added to an OPEN or IN_PROGRESS encounter.',
      silent: true,
    });
  }
}