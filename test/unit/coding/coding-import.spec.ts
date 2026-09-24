import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { validateConceptRows } from '../../../src/modules/coding/domain/coding-import';

describe('coding-import', () => {
  describe('validateConceptRows', () => {
    it('normalizes codes (trim) and passes through display/description/metadata', () => {
      const rows = validateConceptRows([
        { code: '  J18.9  ', display: 'Pneumonia, unspecified', description: '…', metadata: { icd10: true } },
        { code: 'E11', display: 'Type 2 diabetes' },
      ]);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.code).toBe('J18.9');
      expect(rows[1]!.code).toBe('E11');
    });

    it('rejects empty payloads', () => {
      for (const input of [[], undefined] as unknown[]) {
        try {
          validateConceptRows(input);
          throw new Error('expected throw');
        } catch (err) {
          expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
        }
      }
    });

    it('rejects missing code/display and duplicate codes', () => {
      const bad: unknown[] = [
        [{ display: 'No code' }],
        [{ code: '', display: 'empty' }],
        [{ code: 'A', display: '' }],
        [
          { code: 'X', display: 'one' },
          { code: ' X ', display: 'two' },
        ],
      ];
      for (const concepts of bad) {
        try {
          validateConceptRows(concepts);
          throw new Error('expected throw');
        } catch (err) {
          expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
        }
      }
    });

    it('rejects non-object metadata', () => {
      try {
        validateConceptRows([{ code: 'A', display: 'B', metadata: 'nope' }]);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });
});