/**
 * The patient self-scope rule (ADR-051).
 *
 * `TenantScope.patientId` is the value eight services narrow on — the portal
 * projections, `patients.assertPatientOwnership`, queue status, notification
 * principal identity, conversation access and feedback. Before this rule it was
 * never set in production, because the only writer was a test-only header.
 *
 * It is a pure function so the rule can be tested without standing up a request,
 * a session and a database. The alternative — asserting it through the e2e suite
 * only — is how the gap survived in the first place: the portal's own tests
 * injected `patientId` directly, so every one of them passed while no production
 * path could ever set it.
 */

/** The role that marks a login as a patient self-service principal. */
export const PATIENT_ROLE_KEY = 'PATIENT';

export interface PatientLink {
  id: string;
}

/**
 * The patient a principal is self-scoped to, or null.
 *
 * The link and the role are required *together*, and both halves matter:
 *
 *  * Link without the role is a misconfiguration. A staff user who is somehow
 *    linked to a patient record must not acquire a patient scope — the
 *    conjunction turns that into a dead feature instead of a privilege
 *    escalation.
 *  * Role without the link is the common case: a `User` may hold `PATIENT`
 *    before anyone provisions a record for them. Granting a patient scope with
 *    no record behind it would either throw deep inside a service or, worse,
 *    match a query that was meant to be empty.
 *
 * Note what is *not* consulted: the `PATIENT` role's own permissions. Those
 * gate which routes are reachable; this decides what the routes are scoped to.
 */
export function resolvePatientScope(
  link: PatientLink | null | undefined,
  roleKeys: readonly string[],
): string | null {
  if (!link) return null;
  if (!roleKeys.includes(PATIENT_ROLE_KEY)) return null;
  return link.id;
}
