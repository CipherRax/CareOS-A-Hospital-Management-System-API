import { http, HttpResponse } from 'msw';

import {
  INPATIENT_BRANCH_ID,
  INPATIENT_WARDS,
  type RegistryBed,
  type RegistryBedStatus,
  type RegistryRoom,
  type RegistryWard,
} from '@/mocks/fixtures/inpatient-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F8 inpatient handlers (ward board and beds).
 *
 * State is a deep clone of the fixture registry, mutable for the length of the
 * mock session: creating wards, rooms and beds and changing a bed status all move
 * the same records the board reads back. The guards mirror the service — a bed
 * status change is an optimistic-lock write (`version` must match, else 409), and
 * `OCCUPIED` is assignment-driven so it is not an operator-settable status.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type MutableBed = Mutable<RegistryBed>;
interface MutableRoom extends Mutable<Omit<RegistryRoom, 'beds'>> {
  beds: MutableBed[];
}
interface MutableWard extends Mutable<Omit<RegistryWard, 'rooms'>> {
  rooms: MutableRoom[];
}

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

const wards = clone();
let wardSeq = 3004;
let roomSeq = 3302;
let bedSeq = 4303;

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
  ];
}
