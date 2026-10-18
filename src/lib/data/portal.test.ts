import { describe, expect, it } from 'vitest';

import {
  extractPortalAppointments,
  extractPortalLabResults,
  extractPortalPatient,
  readPortalAppointment,
  readPortalLabResult,
  readPortalPatient,
  type PortalAppointment,
  type PortalPatient,
} from '@/lib/data/portal';

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

const appointment: PortalAppointment = {
  id: 'apt_example_2001',
  departmentId: 'dept_example_1',
  providerId: 'usr_example_0002',
  startsAt: '2026-02-10T09:00:00.000Z',
  endsAt: '2026-02-10T09:30:00.000Z',
  mode: 'IN_PERSON',
  status: 'CONFIRMED',
  reason: 'Antenatal check-up',
};

describe('readPortalAppointment', () => {
  it('reads a full projection', () => {
    expect(readPortalAppointment(appointment)).toEqual(appointment);
  });

  it('tolerates a missing reason', () => {
    expect(readPortalAppointment({ ...appointment, reason: null })?.reason).toBeNull();
    expect(readPortalAppointment({ ...appointment, reason: undefined })?.reason).toBeNull();
  });

  it('fails closed on a missing required field', () => {
    expect(readPortalAppointment({ ...appointment, id: '' })).toBeNull();
    expect(readPortalAppointment({ ...appointment, startsAt: '' })).toBeNull();
    expect(readPortalAppointment({ ...appointment, endsAt: '' })).toBeNull();
    expect(readPortalAppointment(null)).toBeNull();
  });

  it('fails closed on an unknown mode or status', () => {
    expect(readPortalAppointment({ ...appointment, mode: 'PHONE' })).toBeNull();
    expect(readPortalAppointment({ ...appointment, status: 'PENDING' })).toBeNull();
  });
});

describe('extractPortalAppointments', () => {
  it('reads the page from the unwrapped data and the sibling meta', () => {
    const parsed = extractPortalAppointments([appointment], { page: 1, limit: 25, total: 40 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.rows).toHaveLength(1);
    expect(parsed.page.total).toBe(40);
  });

  it('falls back to the row count when meta is absent', () => {
    const parsed = extractPortalAppointments([appointment, appointment], null);
    expect(parsed.ok && parsed.page.total).toBe(2);
  });

  it('fails closed when the data is not an array or a row has drifted', () => {
    expect(extractPortalAppointments({ rows: [] }, null).ok).toBe(false);
    expect(extractPortalAppointments([{ id: 'x' }], null).ok).toBe(false);
    expect(extractPortalAppointments(null, null).ok).toBe(false);
  });
});

const labResult = {
  id: 'lab_example_5008',
  orderId: 'labord_example_1',
  itemId: 'labitem_example_1',
  testId: 'test_example_1',
  testName: 'Haemoglobin',
  value: '12.5',
  unit: 'g/dL',
  referenceMin: '12.0',
  referenceMax: '16.0',
  isAbnormal: false,
  isCritical: false,
  verifiedAt: '2026-01-22T10:00:00.000Z',
  releasedAt: '2026-01-23T08:00:00.000Z',
} as const;

describe('readPortalLabResult', () => {
  it('reads a full projection', () => {
    const parsed = readPortalLabResult(labResult);
    expect(parsed?.id).toBe('lab_example_5008');
    expect(parsed?.isCritical).toBe(false);
  });

  it('tolerates nullable reference fields and timestamps', () => {
    const parsed = readPortalLabResult({
      ...labResult,
      testName: null,
      unit: null,
      referenceMin: null,
      referenceMax: null,
      verifiedAt: null,
      releasedAt: null,
    });
    expect(parsed?.testName).toBeNull();
    expect(parsed?.unit).toBeNull();
    expect(parsed?.verifiedAt).toBeNull();
  });

  it('fails closed on a missing required field or wrong type', () => {
    expect(readPortalLabResult({ ...labResult, id: '' })).toBeNull();
    expect(readPortalLabResult({ ...labResult, value: 12.5 })).toBeNull();
    expect(readPortalLabResult({ ...labResult, isAbnormal: 'yes' })).toBeNull();
    expect(readPortalLabResult({ ...labResult, isCritical: null })).toBeNull();
    expect(readPortalLabResult(null)).toBeNull();
  });
});

describe('extractPortalLabResults', () => {
  it('reads the page from the unwrapped data and the sibling meta', () => {
    const parsed = extractPortalLabResults([labResult], { page: 1, limit: 25, total: 2 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.rows).toHaveLength(1);
    expect(parsed.page.total).toBe(2);
  });

  it('falls back to the row count when meta is absent', () => {
    const parsed = extractPortalLabResults([labResult, labResult], null);
    expect(parsed.ok && parsed.page.total).toBe(2);
  });

  it('fails closed when the data is not an array or a row has drifted', () => {
    expect(extractPortalLabResults({ rows: [] }, null).ok).toBe(false);
    expect(extractPortalLabResults([{ id: 'x', value: '5' }], null).ok).toBe(false);
    expect(extractPortalLabResults(null, null).ok).toBe(false);
  });
});
