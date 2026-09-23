/**
 * Body-mass index is always computed in application code from the recorded
 * height/weight — it is never trusted from the wire (brief Phase 3, append-only
 * vital records). Returns null when either measure is missing or implausible.
 */

export function computeBmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (
    weightKg === null ||
    weightKg === undefined ||
    heightCm === null ||
    heightCm === undefined ||
    !Number.isFinite(weightKg) ||
    !Number.isFinite(heightCm) ||
    weightKg <= 0 ||
    heightCm <= 0 ||
    heightCm < 60 ||
    heightCm > 260 ||
    weightKg < 1 ||
    weightKg > 500
  ) {
    return null;
  }
  const meters = heightCm / 100;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}

export type BmiCategory = 'UNDERWEIGHT' | 'NORMAL' | 'OVERWEIGHT' | 'OBESE';

export function bmiCategory(bmi: number): BmiCategory | null {
  if (bmi < 18.5) return 'UNDERWEIGHT';
  if (bmi < 25) return 'NORMAL';
  if (bmi < 30) return 'OVERWEIGHT';
  return 'OBESE';
}