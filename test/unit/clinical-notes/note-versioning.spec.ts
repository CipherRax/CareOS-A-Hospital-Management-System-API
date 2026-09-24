import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  NOTE_SECTION_KEYS,
  assertNoteStatus,
  nextVersionNumber,
  validateNoteSections,
} from '../../../src/modules/clinical-notes/domain/note-versioning';

describe('note-versioning', () => {
  describe('validateNoteSections', () => {
    it('accepts a valid section object', () => {
      const out = validateNoteSections({ chiefComplaint: 'Headache', plan: 'Rest' });
      expect(out.chiefComplaint).toBe('Headache');
    });

    it('rejects empty, arrays, null and unknown keys', () => {
      const bad: unknown[] = [
        {},
        [],
        null,
        42,
        { nope: 'x' },
        { chiefComplaint: 5 },
      ];
      for (const input of bad) {
        try {
          validateNoteSections(input);
          throw new Error('expected throw');
        } catch (err) {
          expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
        }
      }
    });

    it('exposes the documented section keys', () => {
      expect(NOTE_SECTION_KEYS).toContain('chiefComplaint');
      expect(NOTE_SECTION_KEYS).toContain('followUp');
    });
  });

  describe('assertNoteStatus', () => {
    it('passes when status matches expected', () => {
      expect(() => assertNoteStatus('DRAFT', 'DRAFT')).not.toThrow();
      expect(() => assertNoteStatus('FINAL', 'FINAL')).not.toThrow();
    });

    it('throws when the note is not in the expected status', () => {
      try {
        assertNoteStatus('FINAL', 'DRAFT');
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
      }
    });
  });

  describe('nextVersionNumber', () => {
    it('starts at 1 for an empty history and increments past the max', () => {
      expect(nextVersionNumber([])).toBe(1);
      expect(nextVersionNumber([1])).toBe(2);
      expect(nextVersionNumber([1, 2, 3])).toBe(4);
      expect(nextVersionNumber([3, 1, 2])).toBe(4);
    });
  });
});