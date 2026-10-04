/**
 * Version identifier for the caller-facing disclosure text on the anonymous
 * emergency surface (brief §6.15).
 *
 * The frontend must render the disclosure and send back the same
 * `consentVersion` it showed. Storing the accepted version on the request makes
 * "which words did the caller agree to?" auditable when the copy changes, so
 * bump this whenever the disclosure wording changes.
 */
export const EMERGENCY_CONSENT_VERSION = '2026-10-01';

/**
 * The disclosure itself. careOS records and routes a help request to a facility's
 * staff; it does not dispatch emergency services, triage, or guarantee any
 * response time. Numbers below are reference data a caller should verify against
 * their local authority before relying on them.
 */
export const EMERGENCY_DISCLOSURE =
  'Sending a request tells the facility you listed that someone needs help. ' +
  'careOS does not dispatch ambulances, assess how urgent this is, or guarantee a response time. ' +
  'If you are in immediate danger, call your national emergency number now.';

/** True when the caller accepted the current disclosure text. */
export function consentAccepted(version: string | null | undefined): boolean {
  return version === EMERGENCY_CONSENT_VERSION;
}