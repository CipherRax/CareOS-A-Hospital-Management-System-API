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
