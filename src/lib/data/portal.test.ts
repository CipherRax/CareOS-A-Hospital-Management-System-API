import { describe, expect, it } from 'vitest';

import { extractPortalPatient, readPortalPatient, type PortalPatient } from '@/lib/data/portal';

/**
 * F11 portal data layer.
 *
 * The generated OpenAPI types the `/portal/me` body as unknown, so it is
 * validated structurally. Each reader fails closed on drift rather than
 * rendering a half-empty record a patient could read as the clinic's record of
 * them.
 */

const patient: PortalPatient = {
  id: 'pat_example_1001',
  patientNumber: 'PAT-2026-000001',
  firstName: 'EXAMPLE',
  lastName: 'Amina',
  dateOfBirth: '1990-04-12',
  phone: '+254700000000',
  email: 'amina@example.org',
  status: 'ACTIVE',
  createdAt: '2026-01-05T09:00:00.000Z',
};

describe('readPortalPatient', () => {
  it('reads a full projection', () => {
    expect(readPortalPatient(patient)).toEqual(patient);
  });

  it('tolerates the nullable demographics', () => {
    const parsed = readPortalPatient({
      ...patient,
      dateOfBirth: null,
      phone: null,
      email: null,
    });
    expect(parsed?.dateOfBirth).toBeNull();
    expect(parsed?.phone).toBeNull();
    expect(parsed?.email).toBeNull();
  });

  it('fails closed on a missing required field', () => {
    expect(readPortalPatient({ ...patient, id: '' })).toBeNull();
    expect(readPortalPatient({ ...patient, patientNumber: '' })).toBeNull();
    expect(readPortalPatient({ ...patient, firstName: 7 })).toBeNull();
    expect(readPortalPatient({ ...patient, createdAt: '' })).toBeNull();
    expect(readPortalPatient(null)).toBeNull();
  });

  it('fails closed on an unknown status', () => {
    expect(readPortalPatient({ ...patient, status: 'DECEASED' })).toBeNull();
    expect(readPortalPatient({ ...patient, status: 'active' })).toBeNull();
  });
});

describe('extractPortalPatient', () => {
  it('reads the `{ patient }` body', () => {
    const parsed = extractPortalPatient({ patient });
    expect(parsed.ok && parsed.patient.id).toBe('pat_example_1001');
  });

  it('fails closed when there is no patient or the body is not an object', () => {
    expect(extractPortalPatient({}).ok).toBe(false);
    expect(extractPortalPatient({ patient: { id: 'x' } }).ok).toBe(false);
    expect(extractPortalPatient(null).ok).toBe(false);
    expect(extractPortalPatient([patient]).ok).toBe(false);
  });
});
