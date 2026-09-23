import { bmiCategory, computeBmi } from '../../../src/modules/vitals/domain/bmi';

describe('bmi', () => {
  describe('computeBmi', () => {
    it('computes and rounds to one decimal', () => {
      // 70 kg / 1.75 m² = 22.857… → 22.9
      expect(computeBmi(70, 175)).toBe(22.9);
    });

    it('returns null when a measure is missing or implausible', () => {
      expect(computeBmi(null, 175)).toBeNull();
      expect(computeBmi(70, undefined)).toBeNull();
      expect(computeBmi(0, 175)).toBeNull();
      expect(computeBmi(70, 10)).toBeNull();
      expect(computeBmi(NaN, 175)).toBeNull();
    });
  });

  describe('bmiCategory', () => {
    it('classifies the standard bands', () => {
      expect(bmiCategory(17)).toBe('UNDERWEIGHT');
      expect(bmiCategory(22.4)).toBe('NORMAL');
      expect(bmiCategory(27.9)).toBe('OVERWEIGHT');
      expect(bmiCategory(31)).toBe('OBESE');
      expect(bmiCategory(25)).toBe('OVERWEIGHT');
      expect(bmiCategory(30)).toBe('OBESE');
    });
  });
});