/**
 * F4 encounters fixtures (doctor workspace).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the
 * production-build e2e render the same list. Patient ids and names line up with
 * `patients-registry.ts` / `queue-registry.ts`; department ids match
 * `DEPARTMENTS` so a filter or a label agrees with the reception board.
 */

export interface EncounterFixture {
  readonly id: string;
  readonly departmentId: string;
  readonly patientId: string;
  readonly patient: string;
  readonly providerId: string | null;
  readonly type: string;
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
  readonly visitId: string | null;
  readonly note: string | null;
  /** Stamped against the current clock so "opened" reads sensibly on any day. */
  readonly openedMinutesAgo: number;
  readonly inProgressMinutesAgo: number | null;
  readonly completedMinutesAgo: number | null;
}

export const ENCOUNTER_BRANCH_ID = 'br_example_0001';

export const ENCOUNTERS: readonly EncounterFixture[] = [
  {
    id: 'enc_example_6001',
    departmentId: 'dep_example_outpatient',
    patientId: 'pat_example_1001',
    patient: 'EXAMPLE Amina Yusuf',
    providerId: 'usr_example_9001',
    type: 'OUTPATIENT',
    status: 'OPEN',
    visitId: 'vis_example_3001',
    note: null,
    openedMinutesAgo: 14,
    inProgressMinutesAgo: null,
    completedMinutesAgo: null,
  },
  {
    id: 'enc_example_6002',
    departmentId: 'dep_example_emergency',
    patientId: 'pat_example_1002',
    patient: 'EXAMPLE O. Omondi',
    providerId: 'usr_example_9002',
    type: 'EMERGENCY',
    status: 'IN_PROGRESS',
    visitId: 'vis_example_3002',
    note: 'Tachycardic on arrival; monitoring in examination bay 2.',
    openedMinutesAgo: 96,
    inProgressMinutesAgo: 78,
    completedMinutesAgo: null,
  },
  {
    id: 'enc_example_6003',
    departmentId: 'dep_example_paediatrics',
    patientId: 'pat_example_1003',
    patient: 'EXAMPLE Chebet',
    providerId: 'usr_example_9003',
    type: 'FOLLOW_UP',
    status: 'COMPLETED',
    visitId: 'vis_example_3003',
    note: null,
    openedMinutesAgo: 220,
    inProgressMinutesAgo: 205,
    completedMinutesAgo: 170,
  },
  {
    id: 'enc_example_6004',
    departmentId: 'dep_example_outpatient',
    patientId: 'pat_example_1004',
    patient: 'EXAMPLE Njoroge',
    providerId: null,
    type: 'OUTPATIENT',
    status: 'OPEN',
    visitId: 'vis_example_3004',
    note: 'Reviews the previous INR result with the clinician.',
    openedMinutesAgo: 6,
    inProgressMinutesAgo: null,
    completedMinutesAgo: null,
  },
];