/**
 * F8 inpatient fixtures (ward board and bed management).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same wards are duplicated in `e2e/stub-api.mjs` so mock dev and the production
 * build's e2e run cannot silently drift.
 *
 * The beds cover the whole status set — available, occupied, reserved, cleaning,
 * maintenance and blocked — so every tone on the ward board is reachable, and one
 * ward is inactive so the active filter has something to hide.
 */

export type RegistryBedStatus =
  | 'AVAILABLE'
  | 'OCCUPIED'
  | 'RESERVED'
  | 'CLEANING'
  | 'MAINTENANCE'
  | 'BLOCKED';

export interface RegistryBed {
  readonly id: string;
  readonly organizationId: string;
  readonly roomId: string;
  readonly bedNumber: string;
  readonly status: RegistryBedStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegistryRoom {
  readonly id: string;
  readonly organizationId: string;
  readonly wardId: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly beds: readonly RegistryBed[];
}

export interface RegistryWard {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly name: string;
  readonly code: string | null;
  readonly floor: string | null;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly rooms: readonly RegistryRoom[];
}

export const INPATIENT_ORGANIZATION_ID = 'org_example_1';
export const INPATIENT_BRANCH_ID = 'br_example_0001';
const STAMP = '2026-10-01T08:00:00.000Z';

function bed(id: string, roomId: string, bedNumber: string, status: RegistryBedStatus, version = 1): RegistryBed {
  return {
    id,
    organizationId: INPATIENT_ORGANIZATION_ID,
    roomId,
    bedNumber,
    status,
    version,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function room(
  id: string,
  wardId: string,
  name: string,
  description: string | null,
  beds: readonly RegistryBed[],
): RegistryRoom {
  return {
    id,
    organizationId: INPATIENT_ORGANIZATION_ID,
    wardId,
    name,
    description,
    createdAt: STAMP,
    updatedAt: STAMP,
    beds,
  };
}

export const INPATIENT_WARDS: readonly RegistryWard[] = [
  {
    id: 'ward_example_3001',
    organizationId: INPATIENT_ORGANIZATION_ID,
    branchId: INPATIENT_BRANCH_ID,
    name: 'EXAMPLE Medical Ward',
    code: 'MED',
    floor: '1st Floor',
    description: 'EXAMPLE general medical ward.',
    isActive: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    rooms: [
      room('room_example_3101', 'ward_example_3001', 'Room 101', null, [
        bed('bed_example_4101', 'room_example_3101', '101-A', 'OCCUPIED', 3),
        bed('bed_example_4102', 'room_example_3101', '101-B', 'AVAILABLE'),
        bed('bed_example_4103', 'room_example_3101', '101-C', 'CLEANING', 2),
      ]),
      room('room_example_3102', 'ward_example_3001', 'Room 102', 'EXAMPLE side room.', [
        bed('bed_example_4104', 'room_example_3102', '102-A', 'RESERVED'),
        bed('bed_example_4105', 'room_example_3102', '102-B', 'AVAILABLE'),
      ]),
    ],
  },
  {
    id: 'ward_example_3002',
    organizationId: INPATIENT_ORGANIZATION_ID,
    branchId: INPATIENT_BRANCH_ID,
    name: 'EXAMPLE Surgical Ward',
    code: 'SURG',
    floor: '2nd Floor',
    description: 'EXAMPLE post-operative ward.',
    isActive: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    rooms: [
      room('room_example_3201', 'ward_example_3002', 'Room 201', null, [
        bed('bed_example_4201', 'room_example_3201', '201-A', 'OCCUPIED', 4),
        bed('bed_example_4202', 'room_example_3201', '201-B', 'MAINTENANCE', 2),
      ]),
      room('room_example_3202', 'ward_example_3002', 'Room 202', null, [
        bed('bed_example_4203', 'room_example_3202', '202-A', 'AVAILABLE'),
        bed('bed_example_4204', 'room_example_3202', '202-B', 'BLOCKED'),
      ]),
    ],
  },
  {
    id: 'ward_example_3003',
    organizationId: INPATIENT_ORGANIZATION_ID,
    branchId: INPATIENT_BRANCH_ID,
    name: 'EXAMPLE Maternity Ward',
    code: 'MAT',
    floor: '1st Floor',
    description: 'EXAMPLE maternity and newborn ward.',
    isActive: false,
    createdAt: STAMP,
    updatedAt: STAMP,
    rooms: [
      room('room_example_3301', 'ward_example_3003', 'Room 301', null, [
        bed('bed_example_4301', 'room_example_3301', '301-A', 'AVAILABLE'),
        bed('bed_example_4302', 'room_example_3301', '301-B', 'AVAILABLE'),
      ]),
    ],
  },
];

export type RegistryAdmissionSource =
  | 'EMERGENCY'
  | 'OUTPATIENT_CLINIC'
  | 'REFERRAL'
  | 'PLANNED'
  | 'DIRECT';
export type RegistryAdmissionStatus = 'ADMITTED' | 'DISCHARGED';

export interface RegistryBedAssignment {
  readonly id: string;
  readonly bedId: string;
  readonly admissionId: string;
  readonly assignedById: string;
  readonly assignedAt: string;
  readonly releasedById: string | null;
  readonly releasedAt: string | null;
  readonly reason: string | null;
}

export interface RegistryDischarge {
  readonly id: string;
  readonly admissionId: string;
  readonly dischargedById: string | null;
  readonly dischargedAt: string;
  readonly summary: string | null;
  readonly instructions: string | null;
  readonly followUp: { type: string; date: string | null; notes: string | null } | null;
  readonly hasOutstandingBilling: boolean;
}

export interface RegistryAdmission {
  readonly id: string;
  readonly admissionNumber: string;
  readonly patientId: string;
  readonly branchId: string;
  readonly departmentId: string | null;
  readonly encounterId: string | null;
  readonly source: RegistryAdmissionSource;
  readonly status: RegistryAdmissionStatus;
  readonly admittedById: string | null;
  readonly admittedAt: string;
  readonly expectedDischargeAt: string | null;
  readonly provisionalDiagnosis: string | null;
  readonly version: number;
  readonly assignments: readonly RegistryBedAssignment[];
  readonly discharge: RegistryDischarge | null;
}

function assignment(
  id: string,
  bedId: string,
  admissionId: string,
  assignedAt: string,
  releasedAt: string | null = null,
): RegistryBedAssignment {
  return {
    id,
    bedId,
    admissionId,
    assignedById: 'usr_example_0001',
    assignedAt,
    releasedById: releasedAt ? 'usr_example_0001' : null,
    releasedAt,
    reason: null,
  };
}

/**
 * Admissions seeded against the beds above: two ADMITTED holding the two
 * occupied beds and one DISCHARGED with a released assignment and a discharge
 * record, so every branch of the desk is reachable.
 */
export const INPATIENT_ADMISSIONS: readonly RegistryAdmission[] = [
  {
    id: 'adm_example_9001',
    admissionNumber: 'ADM-2026-000001',
    patientId: 'pat_example_1001',
    branchId: INPATIENT_BRANCH_ID,
    departmentId: null,
    encounterId: null,
    source: 'OUTPATIENT_CLINIC',
    status: 'ADMITTED',
    admittedById: 'usr_example_0001',
    admittedAt: '2026-10-05T09:15:00.000Z',
    expectedDischargeAt: '2026-10-12T09:00:00.000Z',
    provisionalDiagnosis: 'EXAMPLE community-acquired pneumonia.',
    version: 1,
    assignments: [
      assignment('asg_example_9501', 'bed_example_4101', 'adm_example_9001', '2026-10-05T09:15:00.000Z'),
    ],
    discharge: null,
  },
  {
    id: 'adm_example_9002',
    admissionNumber: 'ADM-2026-000002',
    patientId: 'pat_example_1002',
    branchId: INPATIENT_BRANCH_ID,
    departmentId: null,
    encounterId: null,
    source: 'EMERGENCY',
    status: 'ADMITTED',
    admittedById: 'usr_example_0001',
    admittedAt: '2026-10-07T22:40:00.000Z',
    expectedDischargeAt: null,
    provisionalDiagnosis: 'EXAMPLE fractured right tibia, post-operative.',
    version: 1,
    assignments: [
      assignment('asg_example_9502', 'bed_example_4201', 'adm_example_9002', '2026-10-07T22:40:00.000Z'),
    ],
    discharge: null,
  },
  {
    id: 'adm_example_9003',
    admissionNumber: 'ADM-2026-000003',
    patientId: 'pat_example_1003',
    branchId: INPATIENT_BRANCH_ID,
    departmentId: null,
    encounterId: null,
    source: 'REFERRAL',
    status: 'DISCHARGED',
    admittedById: 'usr_example_0001',
    admittedAt: '2026-09-20T10:00:00.000Z',
    expectedDischargeAt: null,
    provisionalDiagnosis: 'EXAMPLE diabetic foot ulcer.',
    version: 2,
    assignments: [
      assignment(
        'asg_example_9503',
        'bed_example_4102',
        'adm_example_9003',
        '2026-09-20T10:00:00.000Z',
        '2026-09-27T11:30:00.000Z',
      ),
    ],
    discharge: {
      id: 'dsc_example_9601',
      admissionId: 'adm_example_9003',
      dischargedById: 'usr_example_0001',
      dischargedAt: '2026-09-27T11:30:00.000Z',
      summary: 'EXAMPLE wound healed; discharged on oral antibiotics.',
      instructions: 'EXAMPLE keep the dressing dry; review in clinic.',
      followUp: { type: 'EXAMPLE Outpatient review', date: '2026-10-04T09:00:00.000Z', notes: null },
      hasOutstandingBilling: false,
    },
  },
];

