/**
 * F3 queue fixtures (reception desk).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the
 * production-build e2e render the same board.
 *
 * Rows are stored as *offsets* rather than fixed timestamps: the handler stamps
 * them against the current clock so the "waited" column reads sensibly on any
 * day the demo runs, instead of showing a wait measured from a hard-coded date.
 * The patient names line up with `patients-registry.ts` so the walk-in picker and
 * the board agree on identity.
 */

export interface DepartmentFixture {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly kind: 'STANDARD' | 'CUSTOM';
  readonly active: boolean;
  readonly createdAt: string;
}

export interface QueueEntryFixture {
  readonly id: string;
  readonly ticketNumber: string;
  readonly patientId: string;
  readonly patient: string;
  readonly visitId: string;
  readonly departmentId: string;
  readonly branchId: string;
  readonly status: string;
  readonly operationalPriority: string;
  readonly enteredMinutesAgo: number;
  readonly calledMinutesAgo: number | null;
  readonly serviceStartedMinutesAgo: number | null;
  readonly completedMinutesAgo: number | null;
  readonly note: string | null;
}

export const QUEUE_BRANCH_ID = 'br_example_0001';

export const DEPARTMENTS: readonly DepartmentFixture[] = [
  {
    id: 'dep_example_outpatient',
    name: 'EXAMPLE Outpatient',
    code: 'OPD',
    kind: 'STANDARD',
    active: true,
    createdAt: '2026-01-04T06:00:00.000Z',
  },
  {
    id: 'dep_example_emergency',
    name: 'EXAMPLE Emergency',
    code: 'EMG',
    kind: 'STANDARD',
    active: true,
    createdAt: '2026-01-04T06:00:00.000Z',
  },
  {
    id: 'dep_example_paediatrics',
    name: 'EXAMPLE Paediatrics',
    code: 'PED',
    kind: 'STANDARD',
    active: true,
    createdAt: '2026-01-04T06:00:00.000Z',
  },
  {
    id: 'dep_example_maternity',
    name: 'EXAMPLE Maternity',
    code: 'MAT',
    kind: 'STANDARD',
    active: true,
    createdAt: '2026-01-04T06:00:00.000Z',
  },
];

/**
 * The starting board. "EXAMPLE Amina Yusuf" is already waiting in Outpatient, so
 * the duplicate walk-in refusal (`VISIT_ALREADY_ACTIVE`) is reachable in a demo
 * by trying to queue her again.
 */
export const QUEUE_ENTRIES: readonly QueueEntryFixture[] = [
  {
    id: 'qe_example_2001',
    ticketNumber: 'Q-001',
    patientId: 'pat_example_1003',
    patient: 'EXAMPLE Chebet',
    visitId: 'vis_example_3001',
    departmentId: 'dep_example_emergency',
    branchId: QUEUE_BRANCH_ID,
    status: 'WAITING',
    operationalPriority: 'URGENT',
    enteredMinutesAgo: 24,
    calledMinutesAgo: null,
    serviceStartedMinutesAgo: null,
    completedMinutesAgo: null,
    note: 'Chest pain, triaged by nurse.',
  },
  {
    id: 'qe_example_2002',
    ticketNumber: 'Q-002',
    patientId: 'pat_example_1002',
    patient: 'EXAMPLE O. Omondi',
    visitId: 'vis_example_3002',
    departmentId: 'dep_example_outpatient',
    branchId: QUEUE_BRANCH_ID,
    status: 'CALLED',
    operationalPriority: 'HIGH',
    enteredMinutesAgo: 41,
    calledMinutesAgo: 3,
    serviceStartedMinutesAgo: null,
    completedMinutesAgo: null,
    note: null,
  },
  {
    id: 'qe_example_2003',
    ticketNumber: 'Q-003',
    patientId: 'pat_example_1001',
    patient: 'EXAMPLE Amina Yusuf',
    visitId: 'vis_example_3003',
    departmentId: 'dep_example_outpatient',
    branchId: QUEUE_BRANCH_ID,
    status: 'WAITING',
    operationalPriority: 'NORMAL',
    enteredMinutesAgo: 12,
    calledMinutesAgo: null,
    serviceStartedMinutesAgo: null,
    completedMinutesAgo: null,
    note: null,
  },
  {
    id: 'qe_example_2004',
    ticketNumber: 'Q-004',
    patientId: 'pat_example_1002',
    patient: 'EXAMPLE O. Omondi',
    visitId: 'vis_example_3004',
    departmentId: 'dep_example_paediatrics',
    branchId: QUEUE_BRANCH_ID,
    status: 'IN_SERVICE',
    operationalPriority: 'NORMAL',
    enteredMinutesAgo: 63,
    calledMinutesAgo: 52,
    serviceStartedMinutesAgo: 49,
    completedMinutesAgo: null,
    note: null,
  },
  {
    id: 'qe_example_2005',
    ticketNumber: 'Q-005',
    patientId: 'pat_example_1003',
    patient: 'EXAMPLE Chebet',
    visitId: 'vis_example_3005',
    departmentId: 'dep_example_outpatient',
    branchId: QUEUE_BRANCH_ID,
    status: 'COMPLETED',
    operationalPriority: 'NORMAL',
    enteredMinutesAgo: 120,
    calledMinutesAgo: 95,
    serviceStartedMinutesAgo: 92,
    completedMinutesAgo: 70,
    note: null,
  },
  {
    id: 'qe_example_2006',
    ticketNumber: 'Q-006',
    patientId: 'pat_example_1002',
    patient: 'EXAMPLE O. Omondi',
    visitId: 'vis_example_3006',
    departmentId: 'dep_example_maternity',
    branchId: QUEUE_BRANCH_ID,
    status: 'NO_SHOW',
    operationalPriority: 'LOW',
    enteredMinutesAgo: 88,
    calledMinutesAgo: 60,
    serviceStartedMinutesAgo: null,
    completedMinutesAgo: null,
    note: 'Did not answer the call.',
  },
];

/** Deterministic opening ticket sequence; the handler continues from here. */
export const FIRST_TICKET_SEQUENCE = 7;
