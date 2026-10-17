import { describe, expect, it } from 'vitest';

import { normaliseSessionUser } from '@/lib/data/queries';

/**
 * The header persona comes from `/auth/me`, whose success body the export types
 * as unknown. The mapping is deliberately the single choke point; a drifting
 * response should starve the header, not crash it — and it is also where the
 * staff/patient split is decided, so the two gates cannot disagree.
 */
describe('normaliseSessionUser', () => {
  it('joins first name, other names and last name into the display name', () => {
    const result = normaliseSessionUser({
      user: { id: 'usr_1', firstName: 'EXAMPLE', otherNames: 'N.', lastName: 'Wanjiru' },
      roleDetails: [{ name: 'Registrar' }],
    });
    expect(result).toEqual({
      id: 'usr_1',
      displayName: 'EXAMPLE N. Wanjiru',
      roleLabel: 'Registrar',
      currency: 'KES',
      roles: [],
      patientId: null,
      isPatient: false,
    });
  });

  it('reads the org currency for money display, falling back to KES', () => {
    expect(
      normaliseSessionUser({ organization: { currency: 'UGX' } }).currency,
    ).toBe('UGX');
    expect(normaliseSessionUser({ organization: { currency: '' } }).currency).toBe('KES');
    expect(normaliseSessionUser({ organization: {} }).currency).toBe('KES');
  });

  it('uses the first role detail as the role label', () => {
    const result = normaliseSessionUser({
      user: { id: 'usr_1', firstName: 'EXAMPLE' },
      roleDetails: [{ name: 'Triage' }, { name: 'Fellowship' }],
    });
    expect(result.roleLabel).toBe('Triage');
  });

  it('empties the persona when parts are missing', () => {
    const empty = {
      id: '',
      displayName: '',
      roleLabel: '',
      currency: 'KES',
      roles: [],
      patientId: null,
      isPatient: false,
    };
    expect(normaliseSessionUser(null)).toEqual(empty);
    expect(normaliseSessionUser({ user: undefined })).toEqual(empty);
    expect(normaliseSessionUser({ user: { firstName: 4 } })).toEqual(empty);
  });

  it('reads role keys, dropping anything that is not a string', () => {
    const result = normaliseSessionUser({
      roles: ['DOCTOR', 7, null, 'PATIENT'],
    });
    expect(result.roles).toEqual(['DOCTOR', 'PATIENT']);
  });

  it('treats a PATIENT role with a linked record as a patient principal', () => {
    const result = normaliseSessionUser({
      user: { id: 'usr_1', firstName: 'EXAMPLE' },
      roles: ['PATIENT'],
      patientLink: { patientId: 'pat_example_1001' },
    });
    expect(result.patientId).toBe('pat_example_1001');
    expect(result.isPatient).toBe(true);
  });

  it('requires both the PATIENT role and a linked record', () => {
    // A provisioned-but-unlinked patient account: role without a record is not
    // a patient principal (mirrors `resolvePatientScope` server-side).
    expect(normaliseSessionUser({ roles: ['PATIENT'] }).isPatient).toBe(false);
    // A staff account that happens to be linked to a record is not a patient.
    expect(
      normaliseSessionUser({
        roles: ['REGISTRAR'],
        patientLink: { patientId: 'pat_example_1001' },
      }).isPatient,
    ).toBe(false);
    // An empty patient id is treated as no link at all.
    expect(
      normaliseSessionUser({ roles: ['PATIENT'], patientLink: { patientId: '' } }).isPatient,
    ).toBe(false);
  });

  it('ignores a drifted patientLink shape rather than trusting it', () => {
    expect(
      normaliseSessionUser({ roles: ['PATIENT'], patientLink: { patientId: 42 } }).patientId,
    ).toBeNull();
  });
});
