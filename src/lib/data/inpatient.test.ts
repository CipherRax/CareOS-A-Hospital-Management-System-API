import { describe, expect, it } from 'vitest';

import {
  extractBedRecord,
  extractRoomRecord,
  extractWardPage,
  extractWardRecord,
  readWard,
} from '@/lib/data/inpatient';

/**
 * F8 inpatient data layer.
 *
 * `GET /wards` types the 200 as the request DTO and `GET /wards/{id}` types the
 * bare entity while the service answers `{ ward }` (GAP-020 family); the room and
 * bed writes answer `{ room }` / `{ bed }` while the export types the bare
 * entity. A ward carries its rooms and their beds as one nested shape, so a
 * single drifted bed fails the whole ward closed.
 */

const bed = {
  id: 'bed_example_4101',
  organizationId: 'org_example_1',
  roomId: 'room_example_3101',
  bedNumber: '101-A',
  status: 'OCCUPIED',
  version: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

const room = {
  id: 'room_example_3101',
  organizationId: 'org_example_1',
  wardId: 'ward_example_3001',
  name: 'Room 101',
  description: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  beds: [bed],
};

const ward = {
  id: 'ward_example_3001',
  organizationId: 'org_example_1',
  branchId: 'br_example_0001',
  name: 'EXAMPLE Medical Ward',
  code: 'MED',
  floor: '1st Floor',
  description: 'EXAMPLE general medical ward.',
  isActive: true,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  rooms: [room],
};

describe('readWard', () => {
  it('reads a ward with its nested rooms and beds', () => {
    const parsed = readWard(ward);
    expect(parsed?.name).toBe('EXAMPLE Medical Ward');
    expect(parsed?.rooms[0]?.beds[0]?.bedNumber).toBe('101-A');
    expect(parsed?.rooms[0]?.beds[0]?.status).toBe('OCCUPIED');
  });

  it('defaults absent rooms and beds to empty arrays', () => {
    expect(readWard({ ...ward, rooms: undefined })?.rooms).toEqual([]);
    expect(readWard({ ...ward, rooms: [{ ...room, beds: undefined }] })?.rooms[0]?.beds).toEqual(
      [],
    );
  });

  it('fails closed on a drifted status, a missing id or a broken bed', () => {
    expect(readWard({ ...ward, rooms: [{ ...room, beds: [{ ...bed, status: 'DIRTY' }] }] })).toBeNull();
    expect(readWard({ ...ward, id: undefined })).toBeNull();
    expect(readWard({ ...ward, branchId: undefined })).toBeNull();
    expect(readWard({ ...ward, rooms: [{ id: 'x' }] })).toBeNull();
    expect(readWard(null)).toBeNull();
  });
});

describe('extractWardPage', () => {
  it('reads the unwrapped rows and total from the sibling meta', () => {
    const parsed = extractWardPage([ward], { total: 1, page: 1, limit: 20 });
    expect(parsed.ok && parsed.page.rows[0]?.code).toBe('MED');
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('accepts an empty list and fails closed on a broken body', () => {
    expect(extractWardPage([], undefined).ok && true).toBe(true);
    expect(extractWardPage({ items: [] }, undefined)).toEqual({ ok: false });
    expect(extractWardPage([{}], undefined)).toEqual({ ok: false });
    expect(extractWardPage(null, undefined)).toEqual({ ok: false });
  });
});

describe('extractWardRecord', () => {
  it('unwraps the { ward } body', () => {
    const parsed = extractWardRecord({ ward });
    expect(parsed.ok && parsed.ward.id).toBe('ward_example_3001');
  });

  it('fails closed on a bare ward or a broken body', () => {
    expect(extractWardRecord(ward)).toEqual({ ok: false });
    expect(extractWardRecord({ ward: {} })).toEqual({ ok: false });
    expect(extractWardRecord(null)).toEqual({ ok: false });
  });
});

describe('extractRoomRecord', () => {
  it('unwraps the { room } body into its beds', () => {
    const parsed = extractRoomRecord({ room });
    expect(parsed.ok && parsed.room.name).toBe('Room 101');
    expect(parsed.ok && parsed.room.beds[0]?.bedNumber).toBe('101-A');
  });

  it('fails closed on a bare room or a broken body', () => {
    expect(extractRoomRecord(room)).toEqual({ ok: false });
    expect(extractRoomRecord({ room: { id: 'x' } })).toEqual({ ok: false });
    expect(extractRoomRecord(null)).toEqual({ ok: false });
  });
});

describe('extractBedRecord', () => {
  it('unwraps the { bed } body', () => {
    const parsed = extractBedRecord({ bed });
    expect(parsed.ok && parsed.bed.id).toBe('bed_example_4101');
  });

  it('fails closed on a bare bed or a broken body', () => {
    expect(extractBedRecord(bed)).toEqual({ ok: false });
    expect(extractBedRecord({ bed: { status: 'AVAILABLE' } })).toEqual({ ok: false });
    expect(extractBedRecord(null)).toEqual({ ok: false });
  });
});
