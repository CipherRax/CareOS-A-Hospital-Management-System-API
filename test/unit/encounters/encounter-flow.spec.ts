import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertEncounterOpen,
  assertEncounterTransition,
} from '../../../src/modules/encounters/domain/encounter-flow';

describe('encounter-flow', () => {
  describe('assertEncounterTransition', () => {
    it('allows OPEN → IN_PROGRESS and IN_PROGRESS → COMPLETED', () => {
      expect(() => assertEncounterTransition('OPEN', 'IN_PROGRESS')).not.toThrow();
      expect(() => assertEncounterTransition('IN_PROGRESS', 'COMPLETED')).not.toThrow();
    });

    it('rejects identical statuses', () => {
      try {
        assertEncounterTransition('OPEN', 'OPEN');
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    });

    it('hard-locks a COMPLETED encounter regardless of direction', () => {
      for (const to of ['OPEN', 'IN_PROGRESS', 'COMPLETED'] as const) {
        try {
          assertEncounterTransition('COMPLETED', to);
          throw new Error('expected throw');
        } catch (err) {
          expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
        }
      }
    });
  });

  describe('assertEncounterOpen', () => {
    it('permits OPEN and IN_PROGRESS', () => {
      expect(() => assertEncounterOpen('OPEN')).not.toThrow();
      expect(() => assertEncounterOpen('IN_PROGRESS')).not.toThrow();
    });

    it('rejects COMPLETED', () => {
      try {
        assertEncounterOpen('COMPLETED');
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    });
  });
});