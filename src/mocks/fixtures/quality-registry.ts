/**
 * Quality fixtures (feedback, complaints, incidents — brief Phase 10).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the production
 * build's e2e run cannot silently drift.
 *
 * The statuses cover each lifecycle end to end so every filter a worklist offers
 * has something to select: feedback runs NEW→ACKNOWLEDGED→RESOLVED→CLOSED,
 * complaints OPEN→ASSIGNED→INVESTIGATING→RESOLVED→CLOSED, and incidents
 * OPEN→INVESTIGATING→ACTION_PLAN→RESOLVED→CLOSED. Severities and categories vary
 * so the severity and category filters are exercised too.
 */

export interface RegistryFeedback {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string | null;
  readonly patientId: string | null;
  readonly submittedById: string | null;
  readonly category:
    | 'SERVICE'
    | 'WAITING_TIME'
    | 'STAFF'
    | 'BILLING'
    | 'FACILITY'
    | 'PHARMACY'
    | 'LABORATORY'
    | 'OTHER';
  readonly rating: number;
  readonly comment: string | null;
  readonly status: 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CLOSED';
  readonly response: string | null;
  readonly handledById: string | null;
  readonly handledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegistryComplaint {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string | null;
  readonly origin: 'PATIENT' | 'STAFF' | 'OTHER';
  readonly patientId: string | null;
  readonly submittedById: string | null;
  readonly category: string;
  readonly description: string;
  readonly status: 'OPEN' | 'ASSIGNED' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED';
  readonly assignedToId: string | null;
  readonly dueAt: string | null;
  readonly resolution: string | null;
  readonly closedById: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegistryIncident {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly category:
    | 'OUTAGE'
    | 'EQUIPMENT'
    | 'STOCK_DISCREPANCY'
    | 'DATA_ACCESS'
    | 'FACILITY'
    | 'PATIENT_SAFETY'
    | 'OTHER';
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly description: string;
  readonly reportedById: string;
  readonly status: 'OPEN' | 'INVESTIGATING' | 'ACTION_PLAN' | 'RESOLVED' | 'CLOSED';
  readonly actionsTaken: string | null;
  readonly resolution: string | null;
  readonly resolvedById: string | null;
  readonly resolvedAt: string | null;
  readonly closedById: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const QUALITY_ORGANIZATION_ID = 'org_example_1';
export const QUALITY_BRANCH_ID = 'br_example_0001';
const REPORTER = 'usr-example-1';
const HANDLER = 'usr-example-2';

export const QUALITY_FEEDBACK: readonly RegistryFeedback[] = [
  {
    id: 'fb_example_6101',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    patientId: 'pat_example_1001',
    submittedById: null,
    category: 'WAITING_TIME',
    rating: 2,
    comment: 'EXAMPLE waited over an hour to be triaged during the morning rush.',
    status: 'NEW',
    response: null,
    handledById: null,
    handledAt: null,
    createdAt: '2026-10-02T09:15:00.000Z',
    updatedAt: '2026-10-02T09:15:00.000Z',
  },
  {
    id: 'fb_example_6102',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    patientId: 'pat_example_1002',
    submittedById: null,
    category: 'PHARMACY',
    rating: 3,
    comment: 'EXAMPLE had to come back twice for a prescription that was out of stock.',
    status: 'ACKNOWLEDGED',
    response: null,
    handledById: HANDLER,
    handledAt: '2026-10-03T08:00:00.000Z',
    createdAt: '2026-10-01T14:40:00.000Z',
    updatedAt: '2026-10-03T08:00:00.000Z',
  },
  {
    id: 'fb_example_6103',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: null,
    patientId: 'pat_example_1003',
    submittedById: null,
    category: 'STAFF',
    rating: 5,
    comment: 'EXAMPLE praised the night-shift nurse who stayed past handover.',
    status: 'RESOLVED',
    response: 'EXAMPLE shared with the ward team and recorded in the staff file.',
    handledById: HANDLER,
    handledAt: '2026-10-02T07:30:00.000Z',
    createdAt: '2026-09-29T21:05:00.000Z',
    updatedAt: '2026-10-02T07:30:00.000Z',
  },
  {
    id: 'fb_example_6104',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    patientId: null,
    submittedById: REPORTER,
    category: 'FACILITY',
    rating: 2,
    comment: 'EXAMPLE reported that the outpatient waiting bay has no working fan.',
    status: 'CLOSED',
    response: 'EXAMPLE maintenance replaced the fan on 2026-09-28.',
    handledById: HANDLER,
    handledAt: '2026-09-27T10:00:00.000Z',
    createdAt: '2026-09-26T11:20:00.000Z',
    updatedAt: '2026-09-28T09:00:00.000Z',
  },
  {
    id: 'fb_example_6105',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    patientId: 'pat_example_1001',
    submittedById: null,
    category: 'BILLING',
    rating: 1,
    comment: 'EXAMPLE was charged twice for the same laboratory test.',
    status: 'NEW',
    response: null,
    handledById: null,
    handledAt: null,
    createdAt: '2026-10-04T16:10:00.000Z',
    updatedAt: '2026-10-04T16:10:00.000Z',
  },
];

export const QUALITY_COMPLAINTS: readonly RegistryComplaint[] = [
  {
    id: 'cmp_example_6201',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: null,
    origin: 'PATIENT',
    patientId: 'pat_example_1001',
    submittedById: null,
    category: 'Billing dispute',
    description: 'EXAMPLE claims a duplicate charge on invoice INV-2026-000004.',
    status: 'OPEN',
    assignedToId: null,
    dueAt: '2026-10-09T00:00:00.000Z',
    resolution: null,
    closedById: null,
    closedAt: null,
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  },
  {
    id: 'cmp_example_6202',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    origin: 'STAFF',
    patientId: null,
    submittedById: REPORTER,
    category: 'Handover delay',
    description: 'EXAMPLE reports handover regularly starting more than 30 minutes late.',
    status: 'ASSIGNED',
    assignedToId: HANDLER,
    dueAt: '2026-10-10T00:00:00.000Z',
    resolution: null,
    closedById: null,
    closedAt: null,
    createdAt: '2026-10-01T19:45:00.000Z',
    updatedAt: '2026-10-02T09:05:00.000Z',
  },
  {
    id: 'cmp_example_6203',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    origin: 'PATIENT',
    patientId: 'pat_example_1002',
    submittedById: null,
    category: 'Long wait for results',
    description: 'EXAMPLE waited five days for a radiology report that was marked urgent.',
    status: 'INVESTIGATING',
    assignedToId: HANDLER,
    dueAt: '2026-10-07T00:00:00.000Z',
    resolution: null,
    closedById: null,
    closedAt: null,
    createdAt: '2026-09-30T08:30:00.000Z',
    updatedAt: '2026-10-03T11:00:00.000Z',
  },
  {
    id: 'cmp_example_6204',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: null,
    origin: 'OTHER',
    patientId: null,
    submittedById: REPORTER,
    category: 'Noise at night',
    description: 'EXAMPLE raised construction noise outside the maternity wing after hours.',
    status: 'RESOLVED',
    assignedToId: HANDLER,
    dueAt: null,
    resolution: 'EXAMPLE contractor moved noisy work to daytime hours.',
    closedById: null,
    closedAt: null,
    createdAt: '2026-09-25T22:15:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  },
  {
    id: 'cmp_example_6205',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    origin: 'PATIENT',
    patientId: 'pat_example_1003',
    submittedById: null,
    category: 'Lost records',
    description: 'EXAMPLE reported that a paper referral file could not be found.',
    status: 'CLOSED',
    assignedToId: HANDLER,
    dueAt: null,
    resolution: 'EXAMPLE file located and scanned into the encounter record.',
    closedById: HANDLER,
    closedAt: '2026-09-24T15:00:00.000Z',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-24T15:00:00.000Z',
  },
];

export const QUALITY_INCIDENTS: readonly RegistryIncident[] = [
  {
    id: 'inc_example_6301',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    category: 'STOCK_DISCREPANCY',
    severity: 'HIGH',
    description: 'EXAMPLE count found 12 fewer amoxicillin units than the ledger records.',
    reportedById: REPORTER,
    status: 'OPEN',
    actionsTaken: null,
    resolution: null,
    resolvedById: null,
    resolvedAt: null,
    closedById: null,
    closedAt: null,
    createdAt: '2026-10-02T11:30:00.000Z',
    updatedAt: '2026-10-02T11:30:00.000Z',
  },
  {
    id: 'inc_example_6302',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    category: 'OUTAGE',
    severity: 'CRITICAL',
    description: 'EXAMPLE laboratory analyser lost network connectivity for three hours.',
    reportedById: REPORTER,
    status: 'INVESTIGATING',
    actionsTaken: null,
    resolution: null,
    resolvedById: null,
    resolvedAt: null,
    closedById: null,
    closedAt: null,
    createdAt: '2026-10-01T06:00:00.000Z',
    updatedAt: '2026-10-02T06:30:00.000Z',
  },
  {
    id: 'inc_example_6303',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    category: 'EQUIPMENT',
    severity: 'MEDIUM',
    description: 'EXAMPLE theatre diathermy machine failed its safety check sticker date.',
    reportedById: HANDLER,
    status: 'ACTION_PLAN',
    actionsTaken: 'EXAMPLE unit quarantined and a service call booked for 2026-10-06.',
    resolution: null,
    resolvedById: null,
    resolvedAt: null,
    closedById: null,
    closedAt: null,
    createdAt: '2026-09-28T13:10:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: 'inc_example_6304',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    category: 'PATIENT_SAFETY',
    severity: 'HIGH',
    description: 'EXAMPLE wristband printed with the wrong admission number was caught before use.',
    reportedById: REPORTER,
    status: 'RESOLVED',
    actionsTaken: 'EXAMPLE label printer firmware updated and a double-check step added.',
    resolution: 'EXAMPLE no patient was affected; process change verified over one week.',
    resolvedById: HANDLER,
    resolvedAt: '2026-09-27T16:00:00.000Z',
    closedById: null,
    closedAt: null,
    createdAt: '2026-09-22T10:45:00.000Z',
    updatedAt: '2026-09-27T16:00:00.000Z',
  },
  {
    id: 'inc_example_6305',
    organizationId: QUALITY_ORGANIZATION_ID,
    branchId: QUALITY_BRANCH_ID,
    category: 'DATA_ACCESS',
    severity: 'LOW',
    description: 'EXAMPLE shared account was used to view a record outside the requester’s unit.',
    reportedById: HANDLER,
    status: 'CLOSED',
    actionsTaken: 'EXAMPLE shared login retired and individual accounts issued.',
    resolution: 'EXAMPLE access review completed with no further out-of-scope views found.',
    resolvedById: HANDLER,
    resolvedAt: '2026-09-18T12:00:00.000Z',
    closedById: HANDLER,
    closedAt: '2026-09-19T09:00:00.000Z',
    createdAt: '2026-09-15T08:00:00.000Z',
    updatedAt: '2026-09-19T09:00:00.000Z',
  },
];
