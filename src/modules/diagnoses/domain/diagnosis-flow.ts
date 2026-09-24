import type { Diagnosis, DiagnosisClassification, DiagnosisStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Diagnosis lifecycle (brief §6.6). A diagnosis is recorded against an open
 * encounter (ACTIVE, optional classification). Terminal changes are pure here:
 * resolving closes an ACTIVE diagnosis to RESOLVED (problem list ends); the
 * classification may change while ACTIVE. Everything else (guards, coded
 * validation) lives in the service; nothing is ever deleted.
 */
export interface DiagnosisPatch {
  classification?: DiagnosisClassification;
  resolvedNotes?: string;
}

export function assertDiagnosisActive(status: DiagnosisStatus): void {
  if (status !== 'ACTIVE') {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: 'Only ACTIVE diagnoses can be updated.',
      silent: true,
    });
  }
}

/**
 * Computes the update payload for a diagnosis action. `resolve` requires the
 * diagnosis to be ACTIVE; `classify` requires a new classification and ACTIVE.
 */
export function applyDiagnosisAction(
  current: Pick<Diagnosis, 'status' | 'classification'>,
  action: 'resolve' | 'classify',
  patch: DiagnosisPatch,
): {
  status?: DiagnosisStatus;
  classification?: DiagnosisClassification;
  resolvedAt?: Date;
  resolvedNotes?: string | null;
} {
  if (action === 'resolve') {
    assertDiagnosisActive(current.status);
    return {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedNotes: patch.resolvedNotes ?? null,
    };
  }
  if (action === 'classify') {
    assertDiagnosisActive(current.status);
    if (!patch.classification) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'classification is required for the "classify" action.',
        silent: true,
      });
    }
    if (patch.classification === current.classification) {
      throw new AppError({
        code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
        message: 'The diagnosis already has that classification.',
        silent: true,
      });
    }
    return { classification: patch.classification };
  }
  throw new AppError({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Unknown diagnosis action.',
    silent: true,
  });
}