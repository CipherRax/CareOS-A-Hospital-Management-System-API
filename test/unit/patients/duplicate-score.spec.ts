import {
  DUPLICATE_THRESHOLD,
  isPossibleDuplicate,
  nameSimilarity,
  normalizeText,
  scoreDuplicate,
} from '../../../src/modules/patients/domain/duplicate-score';

describe('duplicate-score', () => {
  describe('normalizeText', () => {
    it('strips accents, lowercases, collapses non-alphanumerics', () => {
      expect(normalizeText('  JOSÉ  OPIYO\t  ')).toBe(' jose opiyo ');
      expect(normalizeText("O'Brien-Wanjiru")).toBe('o brien wanjiru');
    });
  });

  describe('nameSimilarity', () => {
    it('is >= 0.9 for identical long names', () => {
      expect(
        nameSimilarity({ firstName: 'John', lastName: 'Doe' }, { firstName: 'John', lastName: 'Doe' }),
      ).toBeGreaterThanOrEqual(0.9);
    });

    it('survives case + accents', () => {
      expect(
        nameSimilarity({ firstName: 'josé', lastName: 'okonjo' }, { firstName: 'Jose', lastName: 'Okonjo' }),
      ).toBeGreaterThanOrEqual(0.9);
    });

    it('returns 0 when a name is missing', () => {
      expect(nameSimilarity({ firstName: '', lastName: '' }, { firstName: 'X', lastName: 'Y' })).toBe(0);
    });
  });

  describe('scoreDuplicate', () => {
    const base = { firstName: 'Grace', lastName: 'Nyambura' };

    it('phones weight 40 (with 0-prefix local format normalization)', () => {
      const r = scoreDuplicate(
        { firstName: 'A', lastName: 'Z', phone: '0722111222' },
        { firstName: 'B', lastName: 'Y', phone: '+254722111222' },
      );
      expect(r.score).toBe(40);
      expect(r.reasons).toContain('phone');
    });

    it('emails weight 40 (case + whitespace insensitive)', () => {
      const r = scoreDuplicate(
        { firstName: 'A', lastName: 'Z', email: 'Grace.N@Mail.com' },
        { firstName: 'B', lastName: 'Y', email: 'grace.n@mail.com' },
      );
      expect(r.score).toBe(40);
      expect(r.reasons).toContain('email');
    });

    it('exact DOB +20 and sex +10', () => {
      const r = scoreDuplicate(
        { firstName: 'A', lastName: 'Z', dateOfBirth: '1990-05-01', sex: 'FEMALE' },
        { firstName: 'B', lastName: 'Y', dateOfBirth: new Date('1990-05-01T12:00:00Z'), sex: 'female' },
      );
      expect(r.reasons).toEqual(expect.arrayContaining(['dateOfBirth', 'sex']));
      expect(r.score).toBe(30);
    });

    it('caps at 100', () => {
      const identical = scoreDuplicate(
        { firstName: 'John', lastName: 'Doe', phone: '0700111222', email: 'g@n.com', dateOfBirth: '1990-05-01', sex: 'FEMALE' },
        { firstName: 'John', lastName: 'Doe', phone: '0700111222', email: 'g@n.com', dateOfBirth: '1990-05-01', sex: 'FEMALE' },
      );
      expect(identical.score).toBe(100);
    });

    it('zero when nothing matches', () => {
      const r = scoreDuplicate({ ...base, phone: '0711111111' }, { firstName: 'A', lastName: 'B', phone: '0722222222' });
      expect(r.score).toBe(0);
      expect(r.reasons).toHaveLength(0);
    });

    it('name-only matches stay below the threshold (false-positive guard)', () => {
      const r = scoreDuplicate(
        { firstName: 'John', lastName: 'Kamau' },
        { firstName: 'John', lastName: 'Kamau' },
      );
      expect(r.score).toBeLessThan(DUPLICATE_THRESHOLD);
      expect(r.reasons).toContain('name');
    });
  });

  describe('isPossibleDuplicate', () => {
    it('flags identical identity but not a weak match', () => {
      const a = { firstName: 'Diana', lastName: 'Wairimu', phone: '0711222333', dateOfBirth: '1988-02-02' };
      const b = { ...a };
      expect(isPossibleDuplicate(a, b)).toBe(true);

      expect(isPossibleDuplicate({ firstName: 'X', lastName: 'Y' }, { firstName: 'Y', lastName: 'X' })).toBe(false);
    });
  });
});