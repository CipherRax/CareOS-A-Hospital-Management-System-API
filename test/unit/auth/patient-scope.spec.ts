import {
  PATIENT_ROLE_KEY,
  resolvePatientScope,
} from '../../../src/common/auth/patient-scope';

/**
 * The patient self-scope rule (ADR-051).
 *
 * This is the function that decides what `TenantScope.patientId` is, and eight
 * services narrow on that value. It is unit-tested rather than only e2e-tested
 * because the previous arrangement had *no* production writer at all while every
 * portal test passed — the tests injected `patientId` directly, so nothing
 * exercised the rule that was missing.
 */
describe('resolvePatientScope', () => {
  const link = { id: 'patient-1' };

  it('grants the scope to a linked account holding the PATIENT role', () => {
    expect(resolvePatientScope(link, [PATIENT_ROLE_KEY])).toBe('patient-1');
  });

  it('grants the scope alongside other roles, not only when PATIENT is alone', () => {
    // A role list is not exclusive in practice; requiring PATIENT to be the only
    // role would mean a user who also holds another role silently loses access
    // to their own chart.
    expect(resolvePatientScope(link, ['RECEPTIONIST', PATIENT_ROLE_KEY])).toBe(
      'patient-1',
    );
  });

  it('refuses a link with no PATIENT role', () => {
    // The misconfiguration that must not escalate: a staff user who is somehow
    // linked to a patient record gets no patient scope. Dead feature, not a
    // privilege escalation.
    expect(resolvePatientScope(link, ['RECEPTIONIST'])).toBeNull();
    expect(resolvePatientScope(link, [])).toBeNull();
  });

  it('refuses the role with no linked record', () => {
    // Real state between assigning PATIENT and provisioning a record. Granting a
    // scope with no record behind it would match a query meant to be empty.
    expect(resolvePatientScope(null, [PATIENT_ROLE_KEY])).toBeNull();
    expect(resolvePatientScope(undefined, [PATIENT_ROLE_KEY])).toBeNull();
  });

  it('refuses when neither is present, which is the staff default', () => {
    expect(resolvePatientScope(null, ['DOCTOR'])).toBeNull();
  });

  it('matches the role key exactly', () => {
    // A prefix match would let a role named `PATIENT_ADMIN` inherit a patient
    // scope without ever being defined to have one.
    expect(resolvePatientScope(link, ['PATIENT_ADMIN'])).toBeNull();
    expect(resolvePatientScope(link, ['patient'])).toBeNull();
  });
});
