/**
 * F11 patient-portal fixtures.
 *
 * The portal self-scopes: `pat_example_1001` is the same EXAMPLE patient the
 * registry fixtures use, projected through the public allowlist `toPublicPatient`
 * (no clinical fields, no `otherNames`/`sex` — those are not on the wire). Kept
 * identical to the copy in `e2e/stub-api.mjs` so the mock and the stub cannot
 * disagree about what the portal answers.
 */

/** The persona `/auth/me` answers for a patient session (roles + a linked record). */
export const PORTAL_SESSION_USER = {
  id: 'usr_example_pt01',
  email: 'amina@example.org',
  firstName: 'EXAMPLE',
  lastName: 'Yusuf',
  status: 'ACTIVE',
  roles: ['PATIENT'],
} as const;

export const PORTAL_PATIENT_ID = 'pat_example_1001';

/** The `{ patient }` body of `GET /portal/me` for the signed-in patient. */
export const PORTAL_PATIENT = {
  id: PORTAL_PATIENT_ID,
  patientNumber: 'PAT-2026-000001',
  firstName: 'EXAMPLE',
  lastName: 'Yusuf',
  dateOfBirth: '1992-05-14',
  phone: '0700000001',
  email: null,
  status: 'ACTIVE',
  createdAt: '2026-01-05T09:00:00.000Z',
} as const;

/**
 * `GET /portal/me/appointments`, newest first — exactly `toPublicAppointment`'s
 * projection (ids, no names; the portal has no provider/department lookup).
 */
export const PORTAL_APPOINTMENTS = [
  {
    id: 'apt_example_2001',
    departmentId: 'dept_example_1',
    providerId: 'usr_example_0002',
    startsAt: '2026-02-10T09:00:00.000Z',
    endsAt: '2026-02-10T09:30:00.000Z',
    mode: 'IN_PERSON',
    status: 'CONFIRMED',
    reason: 'Antenatal check-up',
  },
  {
    id: 'apt_example_2002',
    departmentId: 'dept_example_2',
    providerId: 'usr_example_0003',
    startsAt: '2026-01-20T14:00:00.000Z',
    endsAt: '2026-01-20T14:30:00.000Z',
    mode: 'VIRTUAL',
    status: 'COMPLETED',
    reason: 'Follow-up',
  },
] as const;

/**
 * `GET /portal/me/lab-results`, newest first — `toPublicLabResult`'s projection
 * (released only). One within-range value and one critical value so the screen's
 * tri-state pill and the "needs attention" path are both exercised.
 */
export const PORTAL_LAB_RESULTS = [
  {
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
  },
  {
    id: 'lab_example_5009',
    orderId: 'labord_example_1',
    itemId: 'labitem_example_2',
    testId: 'test_example_2',
    testName: 'Potassium',
    value: '6.4',
    unit: 'mmol/L',
    referenceMin: '3.5',
    referenceMax: '5.1',
    isAbnormal: true,
    isCritical: true,
    verifiedAt: '2026-01-22T10:00:00.000Z',
    releasedAt: '2026-01-23T08:00:00.000Z',
  },
] as const;
