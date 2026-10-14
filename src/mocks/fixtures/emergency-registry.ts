import { INPATIENT_BRANCH_ID, INPATIENT_ORGANIZATION_ID } from '@/mocks/fixtures/inpatient-registry';

/**
 * F8 emergency fixtures (emergency desk).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same visits are duplicated in `e2e/stub-api.mjs` so mock dev and the production
 * build's e2e run cannot silently drift.
 *
 * The set walks the whole workflow — one visit per status from ARRIVED to the
 * three terminal dispositions — so every action and tone on the desk is
 * reachable, and one visit carries a re-recorded priority.
 */

export type RegistryEmergencyStatus =
  | 'ARRIVED'
  | 'TRIAGED'
  | 'ASSESSED'
  | 'IN_TREATMENT'
  | 'OBSERVATION'
  | 'DISCHARGED'
  | 'ADMITTED'
  | 'REFERRED';

export type RegistryEmergencyPriority =
  | 'RESUSCITATION'
  | 'EMERGENT'
  | 'URGENT'
  | 'SEMI_URGENT'
  | 'NON_URGENT';

export type RegistryEmergencyDisposition = 'ADMITTED' | 'REFERRED' | 'DISCHARGED';

export interface RegistryEmergencyVisit {
  readonly id: string;
  readonly organizationId: string;
  readonly visitNumber: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly status: RegistryEmergencyStatus;
  readonly priority: RegistryEmergencyPriority | null;
  readonly registeredById: string | null;
  readonly arrivedById: string | null;
  readonly arrivedAt: string;
  readonly chiefComplaint: string | null;
  readonly triagedById: string | null;
  readonly triagedAt: string | null;
  readonly assessedAt: string | null;
  readonly assessment: string | null;
  readonly treatmentStartedAt: string | null;
  readonly treatment: string | null;
  readonly observedAt: string | null;
  readonly dispositionAt: string | null;
  readonly disposition: RegistryEmergencyDisposition | null;
  readonly admittedAdmissionId: string | null;
  readonly referredTo: string | null;
  readonly referralNotes: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const ORG = INPATIENT_ORGANIZATION_ID;
const BRANCH = INPATIENT_BRANCH_ID;
const STAFF = 'usr_example_0001';

function visit(
  id: string,
  visitNumber: string,
  patientId: string,
  overrides: Partial<RegistryEmergencyVisit>,
): RegistryEmergencyVisit {
  return {
    id,
    organizationId: ORG,
    visitNumber,
    branchId: BRANCH,
    patientId,
    status: 'ARRIVED',
    priority: null,
    registeredById: STAFF,
    arrivedById: STAFF,
    arrivedAt: '2026-10-10T06:30:00.000Z',
    chiefComplaint: null,
    triagedById: null,
    triagedAt: null,
    assessedAt: null,
    assessment: null,
    treatmentStartedAt: null,
    treatment: null,
    observedAt: null,
    dispositionAt: null,
    disposition: null,
    admittedAdmissionId: null,
    referredTo: null,
    referralNotes: null,
    version: 2,
    createdAt: '2026-10-10T06:30:00.000Z',
    updatedAt: '2026-10-10T06:30:00.000Z',
    ...overrides,
  };
}

export const EMERGENCY_VISITS: readonly RegistryEmergencyVisit[] = [
  visit('erv_example_7001', 'ER-2026-000001', 'pat_example_1001', {
    status: 'ARRIVED',
    arrivedAt: '2026-10-10T06:05:00.000Z',
    version: 1,
    createdAt: '2026-10-10T06:05:00.000Z',
    updatedAt: '2026-10-10T06:05:00.000Z',
  }),
  visit('erv_example_7002', 'ER-2026-000002', 'pat_example_1002', {
    status: 'TRIAGED',
    priority: 'URGENT',
    arrivedAt: '2026-10-10T06:40:00.000Z',
    chiefComplaint: 'EXAMPLE severe abdominal pain and vomiting.',
    triagedById: STAFF,
    triagedAt: '2026-10-10T06:52:00.000Z',
    updatedAt: '2026-10-10T06:52:00.000Z',
  }),
  visit('erv_example_7003', 'ER-2026-000003', 'pat_example_1003', {
    status: 'ASSESSED',
    priority: 'EMERGENT',
    arrivedAt: '2026-10-10T07:10:00.000Z',
    chiefComplaint: 'EXAMPLE shortness of breath at rest.',
    triagedById: STAFF,
    triagedAt: '2026-10-10T07:15:00.000Z',
    assessedAt: '2026-10-10T07:35:00.000Z',
    assessment: 'EXAMPLE hypoxia; suspected pneumonia, oxygen started.',
    version: 4,
    updatedAt: '2026-10-10T07:35:00.000Z',
  }),
  visit('erv_example_7004', 'ER-2026-000004', 'pat_example_1004', {
    status: 'IN_TREATMENT',
    priority: 'URGENT',
    arrivedAt: '2026-10-10T08:00:00.000Z',
    chiefComplaint: 'EXAMPLE deep laceration to the left forearm.',
    triagedById: STAFF,
    triagedAt: '2026-10-10T08:08:00.000Z',
    assessedAt: '2026-10-10T08:20:00.000Z',
    assessment: 'EXAMPLE no tendon involvement; needs irrigation and sutures.',
    treatmentStartedAt: '2026-10-10T08:30:00.000Z',
    treatment: 'EXAMPLE local anaesthetic, wound irrigation and suturing.',
    version: 5,
    updatedAt: '2026-10-10T08:30:00.000Z',
  }),
  visit('erv_example_7005', 'ER-2026-000005', 'pat_example_1001', {
    status: 'OBSERVATION',
    priority: 'SEMI_URGENT',
    arrivedAt: '2026-10-10T09:15:00.000Z',
    chiefComplaint: 'EXAMPLE dizziness on standing.',
    triagedById: STAFF,
    triagedAt: '2026-10-10T09:22:00.000Z',
    assessedAt: '2026-10-10T09:40:00.000Z',
    assessment: 'EXAMPLE postural drop; observing after fluids.',
    treatmentStartedAt: '2026-10-10T09:50:00.000Z',
    treatment: 'EXAMPLE intravenous fluids given.',
    observedAt: '2026-10-10T10:30:00.000Z',
    version: 6,
    updatedAt: '2026-10-10T10:30:00.000Z',
  }),
  visit('erv_example_7006', 'ER-2026-000006', 'pat_example_1002', {
    status: 'DISCHARGED',
    priority: 'NON_URGENT',
    arrivedAt: '2026-10-10T10:00:00.000Z',
    chiefComplaint: 'EXAMPLE minor ankle sprain.',
    triagedById: STAFF,
    triagedAt: '2026-10-10T10:05:00.000Z',
    assessedAt: '2026-10-10T10:20:00.000Z',
    assessment: 'EXAMPLE stable sprain, no fracture on X-ray.',
    treatmentStartedAt: '2026-10-10T10:30:00.000Z',
    treatment: 'EXAMPLE supportive bandage and analgesia.',
    dispositionAt: '2026-10-10T11:00:00.000Z',
    disposition: 'DISCHARGED',
    version: 7,
    updatedAt: '2026-10-10T11:00:00.000Z',
  }),
  visit('erv_example_7007', 'ER-2026-000007', 'pat_example_1002', {
    status: 'ADMITTED',
    priority: 'EMERGENT',
    arrivedAt: '2026-10-10T11:10:00.000Z',
    chiefComplaint: 'EXAMPLE displaced ankle fracture.',
    triagedById: STAFF,
    triagedAt: '2026-10-10T11:15:00.000Z',
    assessedAt: '2026-10-10T11:30:00.000Z',
    assessment: 'EXAMPLE fracture requiring surgery; admitted orthopaedics.',
    treatmentStartedAt: '2026-10-10T11:40:00.000Z',
    treatment: 'EXAMPLE splinted and analgesia.',
    dispositionAt: '2026-10-10T12:20:00.000Z',
    disposition: 'ADMITTED',
    admittedAdmissionId: 'adm_example_9002',
    version: 8,
    updatedAt: '2026-10-10T12:20:00.000Z',
  }),
  visit('erv_example_7008', 'ER-2026-000008', 'pat_example_1004', {
    status: 'REFERRED',
    priority: 'URGENT',
    arrivedAt: '2026-10-10T12:00:00.000Z',
    chiefComplaint: 'EXAMPLE suspected transient ischaemic attack.',
    triagedById: STAFF,
    triagedAt: '2026-10-10T12:05:00.000Z',
    assessedAt: '2026-10-10T12:25:00.000Z',
    assessment: 'EXAMPLE neurology review required urgently.',
    dispositionAt: '2026-10-10T12:50:00.000Z',
    disposition: 'REFERRED',
    referredTo: 'EXAMPLE Regional Neurology Unit',
    referralNotes: 'EXAMPLE referred for immediate specialist assessment.',
    version: 6,
    updatedAt: '2026-10-10T12:50:00.000Z',
  }),
];
