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
