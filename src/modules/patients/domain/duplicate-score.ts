/**
 * Pure duplicate-detection scoring. No I/O here — candidates are fetched by the
 * service, scored here. A new registration that clears the threshold is surfaced
 * to the creator (409 POSSIBLE_DUPLICATE) unless they explicitly confirm it is
 * NOT a duplicate, which is written to the record as duplicateConfirmedAt/By.
 */
export const DUPLICATE_THRESHOLD = 70;

export interface PatientKeyFacts {
  firstName: string;
  lastName: string;
  otherNames?: string | null;
  dateOfBirth?: Date | string | null;
  sex?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface DuplicateScore {
  score: number;
  reasons: string[];
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function normalizePhone(value: string | null | undefined): string {
  if (!value) return '';
  let digits = value.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  if (digits.length === 9) digits = `254${digits}`;
  return digits;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Human-readable bigram Dice coefficient on the normalized name. */
export function nameSimilarity(a: PatientKeyFacts, b: PatientKeyFacts): number {
  const read = (p: PatientKeyFacts): string =>
    [p.lastName, p.firstName, p.otherNames].filter((v) => v).join(' ');
  const sa = normalizeText(read(a));
  const sb = normalizeText(read(b));
  if (!sa || !sb) return 0;

  const grams = (s: string, k = 2): string[] => {
    const out: string[] = [];
    for (let i = 0; i <= s.length - k; i += 1) out.push(s.slice(i, i + k));
    return out;
  };
  const ga = new Set(grams(sa));
  const gb = grams(sb);
  if (ga.size === 0) return 0;
  let overlap = 0;
  for (const g of gb) {
    if (ga.has(g)) overlap += 1;
  }
  return (2 * overlap) / (ga.size + gb.length);
}

function dobKey(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Scores a candidate against the submitted facts on a 0..100 scale.
 *
 * Weights (additive, capped at 100):
 *   - exact normalized phone               +40
 *   - exact normalized email               +40
 *   - name bigram similarity               +40 × similarity
 *   - identical date of birth              +20
 *   - identical sex                        +10
 *
 * A registration only flags when it clears DUPLICATE_THRESHOLD; name/phone or
 * name/email matches alone (common false-positive zone) stay below it.
 */
export function scoreDuplicate(input: PatientKeyFacts, candidate: PatientKeyFacts): DuplicateScore {
  let score = 0;
  const reasons: string[] = [];

  const inputPhone = normalizePhone(input.phone);
  const candidatePhone = normalizePhone(candidate.phone);
  if (inputPhone && inputPhone === candidatePhone) {
    score += 40;
    reasons.push('phone');
  }

  const inputEmail = normalizeEmail(input.email);
  const candidateEmail = normalizeEmail(candidate.email);
  if (inputEmail && inputEmail === candidateEmail) {
    score += 40;
    reasons.push('email');
  }

  const sim = nameSimilarity(input, candidate);
  if (sim > 0) {
    score += Math.round(40 * sim);
    if (sim >= 0.9) reasons.push('name');
  }

  const inputDob = dobKey(input.dateOfBirth);
  if (inputDob && inputDob === dobKey(candidate.dateOfBirth)) {
    score += 20;
    reasons.push('dateOfBirth');
  }

  if (
    input.sex &&
    candidate.sex &&
    input.sex.toLowerCase() === candidate.sex.toLowerCase()
  ) {
    score += 10;
    reasons.push('sex');
  }

  return {
    score: Math.min(100, Math.round(score)),
    reasons: [...new Set(reasons)],
  };
}

export function isPossibleDuplicate(input: PatientKeyFacts, candidate: PatientKeyFacts): boolean {
  return scoreDuplicate(input, candidate).score >= DUPLICATE_THRESHOLD;
}