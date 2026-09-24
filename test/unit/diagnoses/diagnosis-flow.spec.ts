import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { applyDiagnosisAction } from '../../../src/modules/diagnoses/domain/diagnosis-flow';

describe('diagnosis-flow', () => {
  describe('applyDiagnosisAction', () => {
    it('resolves an ACTIVE diagnosis', () => {
      const patch = applyDiagnosisAction(
        { status: 'ACTIVE', classification: 'PRIMARY' },
        'resolve',
        { resolvedNotes: 'resolved' },
      );
      expect(patch.status).toBe('RESOLVED');
      expect(patch.resolvedNotes).toBe('resolved');
      expect(patch.resolvedAt).toBeInstanceOf(Date);
    });

    it('rejects resolving a non-ACTIVE diagnosis', () => {
      for (const status of ['RESOLVED', 'HISTORICAL', 'AMENDED'] as const) {
        try {
          applyDiagnosisAction({ status, classification: 'PRIMARY' }, 'resolve', {});
          throw new Error('expected throw');
        } catch (err) {
          expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
        }
      }
    });

    it('re-classifies an ACTIVE diagnosis', () => {
      const patch = applyDiagnosisAction({ status: 'ACTIVE', classification: 'PRIMARY' }, 'classify', {
        classification: 'SECONDARY',
      });
      expect(patch.classification).toBe('SECONDARY');
    });

    it('rejects classify without a change or without classification', () => {
      try {
        applyDiagnosisAction({ status: 'ACTIVE', classification: 'PRIMARY' }, 'classify', {});
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
      try {
        applyDiagnosisAction({ status: 'ACTIVE', classification: 'PRIMARY' }, 'classify', {
          classification: 'PRIMARY',
        });
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    });
  });
});