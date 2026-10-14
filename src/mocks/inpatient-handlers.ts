import { http, HttpResponse } from 'msw';

import {
  INPATIENT_ADMISSIONS,
  INPATIENT_BRANCH_ID,
  INPATIENT_WARDS,
  type RegistryAdmission,
  type RegistryBed,
  type RegistryBedAssignment,
  type RegistryBedStatus,
  type RegistryDischarge,
  type RegistryRoom,
  type RegistryWard,
} from '@/mocks/fixtures/inpatient-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F8 inpatient handlers (ward board, beds and admissions).
 *
 * State is a deep clone of the fixture registry, mutable for the length of the
 * mock session: creating wards, rooms and beds, changing a bed status and
 * admitting, transferring or discharging a patient all move the same records the
 * board and the desk read back. The guards mirror the service — a bed status
 * change is an optimistic-lock write (`version` must match, else 409), `OCCUPIED`
 * is assignment-driven, and admission writes move the bed status with them.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type MutableBed = Mutable<RegistryBed>;
interface MutableRoom extends Mutable<Omit<RegistryRoom, 'beds'>> {
  beds: MutableBed[];
}
interface MutableWard extends Mutable<Omit<RegistryWard, 'rooms'>> {
  rooms: MutableRoom[];
}

type MutableAdmission = Mutable<Omit<RegistryAdmission, 'assignments' | 'discharge'>> & {
  assignments: Mutable<RegistryBedAssignment>[];
  discharge: Mutable<RegistryDischarge> | null;
};

const MANUAL_BED_STATUSES: readonly RegistryBedStatus[] = [
  'AVAILABLE',
  'RESERVED',
  'CLEANING',
  'MAINTENANCE',
  'BLOCKED',
];

function clone(): MutableWard[] {
  return INPATIENT_WARDS.map((ward) => ({
    ...ward,
    rooms: ward.rooms.map((room) => ({
      ...room,
      beds: room.beds.map((bed) => ({ ...bed })),
    })),
  }));
}

function cloneAdmissions(): MutableAdmission[] {
  return INPATIENT_ADMISSIONS.map((admission) => ({
    ...admission,
    assignments: admission.assignments.map((row) => ({ ...row })),
    discharge: admission.discharge ? { ...admission.discharge } : null,
  }));
}

const wards = clone();
const admissions = cloneAdmissions();
let wardSeq = 3004;
let roomSeq = 3302;
let bedSeq = 4303;
let admissionSeq = 9004;
let assignmentSeq = 9504;
let dischargeSeq = 9602;

function findWard(id: string): MutableWard | undefined {
  return wards.find((ward) => ward.id === id);
}

function findRoom(id: string): { ward: MutableWard; room: MutableRoom } | undefined {
  for (const ward of wards) {
    const room = ward.rooms.find((row) => row.id === id);
    if (room) return { ward, room };
  }
  return undefined;
}

function findBed(id: string): { ward: MutableWard; room: MutableRoom; bed: MutableBed } | undefined {
  for (const ward of wards) {
    for (const room of ward.rooms) {
      const bed = room.beds.find((row) => row.id === id);
      if (bed) return { ward, room, bed };
    }
  }
  return undefined;
}

function findAdmission(id: string): MutableAdmission | undefined {
  return admissions.find((admission) => admission.id === id);
}

function activeAssignment(admission: MutableAdmission): Mutable<RegistryBedAssignment> | undefined {
  return admission.assignments.find((row) => row.releasedAt === null);
}

/** A bed is assignable when it is AVAILABLE and no active admission holds it. */
function bedAssignable(bedId: string): boolean {
  const found = findBed(bedId);
  if (!found || found.bed.status !== 'AVAILABLE') return false;
  return !admissions.some(
    (admission) =>
      admission.status === 'ADMITTED' &&
      admission.assignments.some((row) => row.bedId === bedId && row.releasedAt === null),
  );
}

function notFound(message: string) {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
}

function validationError(message: string) {
  return HttpResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function inpatientHandlers() {
  return [
    http.get('*/api/v1/wards', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const branchId = url.searchParams.get('branchId');
      const active = url.searchParams.get('active');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20));

      const filtered = wards.filter((ward) => {
        if (branchId && ward.branchId !== branchId) return false;
        if (active !== null && String(ward.isActive) !== active) return false;
        return true;
      });
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/wards/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const ward = findWard(String(params.id));
      if (!ward) return notFound('Ward not found');
      return HttpResponse.json(apiOk({ ward }, 'req_mock_ward'));
    }),

    http.post('*/api/v1/wards', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const name = stringField(body?.name);
      if (!name) return validationError('A ward name is required.');
      if (body?.branchId !== INPATIENT_BRANCH_ID) return notFound('Branch not found');

      const now = new Date().toISOString();
      const ward: MutableWard = {
        id: `ward_example_${wardSeq++}`,
        organizationId: 'org_example_1',
        branchId: INPATIENT_BRANCH_ID,
        name,
        code: stringField(body?.code),
        floor: stringField(body?.floor),
        description: stringField(body?.description),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        rooms: [],
      };
      wards.push(ward);
      return HttpResponse.json(apiOk({ ward }, 'req_mock_ward_create'), { status: 201 });
    }),

    http.post('*/api/v1/wards/:id/rooms', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const ward = findWard(String(params.id));
      if (!ward) return notFound('Ward not found');
      const body = await readJson(request);
      const name = stringField(body?.name);
      if (!name) return validationError('A room name is required.');

      const now = new Date().toISOString();
      const room: MutableRoom = {
        id: `room_example_${roomSeq++}`,
        organizationId: 'org_example_1',
        wardId: ward.id,
        name,
        description: stringField(body?.description),
        createdAt: now,
        updatedAt: now,
        beds: [],
      };
      ward.rooms.push(room);
      return HttpResponse.json(apiOk({ room }, 'req_mock_room_create'), { status: 201 });
    }),

    http.post('*/api/v1/rooms/:id/beds', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const found = findRoom(String(params.id));
      if (!found) return notFound('Room not found');
      const body = await readJson(request);
      const bedNumber = stringField(body?.bedNumber);
      if (!bedNumber) return validationError('A bed number is required.');

      const now = new Date().toISOString();
      const bed: MutableBed = {
        id: `bed_example_${bedSeq++}`,
        organizationId: 'org_example_1',
        roomId: found.room.id,
        bedNumber,
        status: 'AVAILABLE',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      found.room.beds.push(bed);
      return HttpResponse.json(apiOk({ bed }, 'req_mock_bed_create'), { status: 201 });
    }),

    http.patch('*/api/v1/beds/:id/status', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const found = findBed(String(params.id));
      if (!found) return notFound('Bed not found');
      const body = await readJson(request);
      const status = body?.status;
      if (typeof status !== 'string' || !MANUAL_BED_STATUSES.includes(status as RegistryBedStatus)) {
        return validationError(
          'Bed status must be AVAILABLE, RESERVED, CLEANING, MAINTENANCE or BLOCKED. OCCUPIED is assigned by the system when a patient is admitted.',
        );
      }
      if (typeof body?.version !== 'number' || body.version !== found.bed.version) {
        return HttpResponse.json(
          apiError('OPTIMISTIC_LOCK_CONFLICT', 'Bed changed underneath this update.'),
          { status: 409 },
        );
      }
      found.bed.status = status as RegistryBedStatus;
      found.bed.version += 1;
      found.bed.updatedAt = new Date().toISOString();
      return HttpResponse.json(apiOk({ bed: found.bed }, 'req_mock_bed_status'));
    }),

    http.get('*/api/v1/admissions', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const patientId = url.searchParams.get('patientId');
      const status = url.searchParams.get('status');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20));

      const filtered = admissions
        .filter((admission) => {
          if (patientId && admission.patientId !== patientId) return false;
          if (status && admission.status !== status) return false;
          return true;
        })
        .sort((a, b) => b.admittedAt.localeCompare(a.admittedAt));
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/admissions/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const admission = findAdmission(String(params.id));
      if (!admission) return notFound('Admission not found');
      return HttpResponse.json(apiOk({ admission }, 'req_mock_admission'));
    }),

    http.post('*/api/v1/admissions', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const patientId = stringField(body?.patientId);
      const bedId = stringField(body?.bedId);
      if (!patientId || !bedId) return validationError('A patient and a bed are required.');
      if (body?.branchId !== INPATIENT_BRANCH_ID) return notFound('Branch not found');
      const bed = findBed(bedId);
      if (!bed) return notFound('Bed not found');
      if (admissions.some((a) => a.patientId === patientId && a.status === 'ADMITTED')) {
        return HttpResponse.json(
          apiError('ADMISSION_ALREADY_ACTIVE', 'The patient already has an active admission.'),
          { status: 409 },
        );
      }
      if (!bedAssignable(bedId)) {
        return HttpResponse.json(
          apiError('BED_UNAVAILABLE', 'The selected bed is not available.'),
          { status: 409 },
        );
      }

      const now = new Date().toISOString();
      const id = `adm_example_${admissionSeq++}`;
      const admission: MutableAdmission = {
        id,
        admissionNumber: `ADM-${now.slice(0, 4)}-${String(admissionSeq - 1).padStart(6, '0')}`,
        patientId,
        branchId: INPATIENT_BRANCH_ID,
        departmentId: stringField(body?.departmentId),
        encounterId: stringField(body?.encounterId),
        source: 'OUTPATIENT_CLINIC',
        status: 'ADMITTED',
        admittedById: 'usr_example_0001',
        admittedAt: now,
        expectedDischargeAt: stringField(body?.expectedDischargeAt),
        provisionalDiagnosis: stringField(body?.provisionalDiagnosis),
        version: 1,
        assignments: [
          {
            id: `asg_example_${assignmentSeq++}`,
            bedId,
            admissionId: id,
            assignedById: 'usr_example_0001',
            assignedAt: now,
            releasedById: null,
            releasedAt: null,
            reason: null,
          },
        ],
        discharge: null,
      };
      admissions.push(admission);
      bed.bed.status = 'OCCUPIED';
      bed.bed.version += 1;
      bed.bed.updatedAt = now;
      return HttpResponse.json(apiOk({ admission }, 'req_mock_admission_create'), { status: 201 });
    }),

    http.post('*/api/v1/admissions/:id/transfer', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const admission = findAdmission(String(params.id));
      if (!admission) return notFound('Admission not found');
      if (admission.status !== 'ADMITTED') {
        return HttpResponse.json(
          apiError('INVALID_WORKFLOW_TRANSITION', 'A discharged admission cannot be transferred.'),
          { status: 409 },
        );
      }
      const body = await readJson(request);
      const toBedId = stringField(body?.toBedId);
      if (!toBedId) return validationError('A target bed is required.');
      const active = activeAssignment(admission);
      if (!active) {
        return HttpResponse.json(
          apiError('INVALID_WORKFLOW_TRANSITION', 'The admission has no active bed assignment.'),
          { status: 409 },
        );
      }
      if (active.bedId === toBedId) return validationError('The target bed is the current bed.');
      if (!bedAssignable(toBedId)) {
        return HttpResponse.json(
          apiError('BED_UNAVAILABLE', 'The target bed is not available.'),
          { status: 409 },
        );
      }

      const now = new Date().toISOString();
      const previous = findBed(active.bedId);
      active.releasedById = 'usr_example_0001';
      active.releasedAt = now;
      active.reason = stringField(body?.reason);
      if (previous) {
        previous.bed.status = 'AVAILABLE';
        previous.bed.version += 1;
        previous.bed.updatedAt = now;
      }
      const target = findBed(toBedId);
      if (target) {
        target.bed.status = 'OCCUPIED';
        target.bed.version += 1;
        target.bed.updatedAt = now;
      }
      admission.assignments.push({
        id: `asg_example_${assignmentSeq++}`,
        bedId: toBedId,
        admissionId: admission.id,
        assignedById: 'usr_example_0001',
        assignedAt: now,
        releasedById: null,
        releasedAt: null,
        reason: null,
      });
      admission.version += 1;
      return HttpResponse.json(apiOk({ admission }, 'req_mock_admission_transfer'), { status: 201 });
    }),

    http.post('*/api/v1/admissions/:id/discharge', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const admission = findAdmission(String(params.id));
      if (!admission) return notFound('Admission not found');
      if (admission.status !== 'ADMITTED') {
        return HttpResponse.json(
          apiError('INVALID_WORKFLOW_TRANSITION', 'The admission is already discharged.'),
          { status: 409 },
        );
      }
      const body = await readJson(request);
      const now = new Date().toISOString();
      const discharge: Mutable<RegistryDischarge> = {
        id: `dsc_example_${dischargeSeq++}`,
        admissionId: admission.id,
        dischargedById: 'usr_example_0001',
        dischargedAt: stringField(body?.dischargedAt) ?? now,
        summary: stringField(body?.summary),
        instructions: stringField(body?.instructions),
        followUp: isFollowUp(body?.followUp) ? (body?.followUp as RegistryDischarge['followUp']) : null,
        hasOutstandingBilling: body?.hasOutstandingBilling === true,
      };
      admission.discharge = discharge;
      admission.status = 'DISCHARGED';
      admission.version += 1;

      const active = activeAssignment(admission);
      if (active) {
        active.releasedById = 'usr_example_0001';
        active.releasedAt = now;
        const bed = findBed(active.bedId);
        if (bed) {
          bed.bed.status = 'CLEANING';
          bed.bed.version += 1;
          bed.bed.updatedAt = now;
        }
      }
      return HttpResponse.json(apiOk({ admission }, 'req_mock_admission_discharge'), { status: 201 });
    }),
  ];
}

function isFollowUp(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).type === 'string'
  );
}
