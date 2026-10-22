/**
 * Retention categories and the anonymization rules (brief §8).
 *
 * A RetentionPolicy is org reference data: one row per category, holding a
 * retention window and the action to take once it elapses. The categories
 * below are the ones this codebase can act on; an unknown category is rejected
 * rather than stored, because a policy nobody can execute is a policy that
 * silently does nothing.
 */

/** Record categories a retention policy may target. */
export const RETENTION_CATEGORIES = [
  'patient',
  'encounter',
  'appointment',
  'clinical_note',
  'lab_result',
  'radiology_report',
  'invoice',
  'audit_log',
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export function isRetentionCategory(value: string): value is RetentionCategory {
  return (RETENTION_CATEGORIES as readonly string[]).includes(value);
}

/** The action a policy takes once the window elapses. */
export const RETENTION_ACTIONS = ['ARCHIVE', 'ANONYMIZE', 'REVIEW'] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

/** Bounds on the retention window, in days. */
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

/**
 * The fields a patient's record is reduced to when it is anonymized.
 *
 * Anonymization replaces the direct identifiers with a stable, non-reversible
 * placeholder and keeps the record's existence, dates and clinical structure:
 * a cohort that still counts encounters still counts them, but no longer
 * identifies the person. The placeholder carries the patient's id so an
 * operator can tell that two rows belong to the same anonymized subject
 * without learning who that subject was.
 */
export interface AnonymizationPlan {
  readonly firstName: string;
  readonly lastName: string;
  readonly otherNames: string | null;
  readonly dateOfBirth: Date | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly county: string | null;
  readonly town: string | null;
  readonly photoUrl: string | null;
}

/**
 * Builds the anonymized replacement for a patient's direct identifiers.
 *
 * The deterministic `ANON-<id>` style subject key is derived from the patient's
 * id, so repeated anonymization of the same record yields the same key and the
 * two runs do not disagree about who the subject is. The name parts are fixed
 * strings rather than a hash: a hash of a name is still a name, and short
 * names hash into a small space.
 */
export function planAnonymization(patientId: string): AnonymizationPlan {
  const subject = `ANON-${patientId.slice(0, 8).toUpperCase()}`;
  return {
    firstName: 'ANONYMIZED',
    lastName: subject,
    otherNames: null,
    dateOfBirth: null,
    phone: null,
    email: null,
    address: null,
    county: null,
    town: null,
    photoUrl: null,
  };
}
