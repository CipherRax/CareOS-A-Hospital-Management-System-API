import { describe, expect, it } from 'vitest';

import {
  activeAssignment,
  collectBeds,
  extractAdmissionPage,
  extractAdmissionRecord,
  extractBedRecord,
  extractRoomRecord,
  extractWardPage,
  extractWardRecord,
  readAdmission,
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

const assignment = {
  id: 'asg_example_9501',
  bedId: 'bed_example_4101',
  admissionId: 'adm_example_9001',
  assignedById: 'usr_example_0001',
  assignedAt: '2026-10-05T09:15:00.000Z',
  releasedById: null,
  releasedAt: null,
  reason: null,
};

const discharge = {
  id: 'dsc_example_9601',
  admissionId: 'adm_example_9003',
  dischargedById: 'usr_example_0001',
  dischargedAt: '2026-09-27T11:30:00.000Z',
  summary: 'EXAMPLE wound healed.',
  instructions: 'EXAMPLE keep the dressing dry.',
  followUp: { type: 'EXAMPLE Outpatient review', date: '2026-10-04T09:00:00.000Z', notes: null },
  hasOutstandingBilling: false,
};

const admission = {
  id: 'adm_example_9001',
  admissionNumber: 'ADM-2026-000001',
  patientId: 'pat_example_1001',
  branchId: 'br_example_0001',
  departmentId: null,
  encounterId: null,
  source: 'OUTPATIENT_CLINIC',
  status: 'ADMITTED',
  admittedById: 'usr_example_0001',
  admittedAt: '2026-10-05T09:15:00.000Z',
  expectedDischargeAt: '2026-10-12T09:00:00.000Z',
  provisionalDiagnosis: 'EXAMPLE community-acquired pneumonia.',
  version: 1,
  assignments: [assignment],
  discharge: null,
};

/**
 * F8 slice 2 admissions.
 *
 * `GET /admissions` types the 200 as the request DTO and `GET /admissions/{id}`
 * types the bare entity while the service answers a `PageResult` / `{ admission }`
 * (GAP-020 family). An admission carries its bed-assignment history and an
 * optional discharge as one shape, so a single drifted assignment fails the whole
 * admission closed — a bed shown against the wrong patient is a safety problem.
 */
describe('readAdmission', () => {
  it('reads an admission with its bed-assignment history', () => {
    const parsed = readAdmission(admission);
    expect(parsed?.admissionNumber).toBe('ADM-2026-000001');
    expect(parsed?.source).toBe('OUTPATIENT_CLINIC');
    expect(parsed?.assignments[0]?.bedId).toBe('bed_example_4101');
    expect(parsed?.discharge).toBeNull();
  });

  it('reads a nested discharge and follow-up', () => {
    const parsed = readAdmission({ ...admission, status: 'DISCHARGED', discharge });
    expect(parsed?.discharge?.followUp?.type).toBe('EXAMPLE Outpatient review');
    expect(parsed?.discharge?.hasOutstandingBilling).toBe(false);
  });

  it('fails closed on a drifted status, source, id or broken child', () => {
    expect(readAdmission({ ...admission, status: 'WAITING' })).toBeNull();
    expect(readAdmission({ ...admission, source: 'WALK_IN' })).toBeNull();
    expect(readAdmission({ ...admission, id: undefined })).toBeNull();
    expect(readAdmission({ ...admission, admittedAt: undefined })).toBeNull();
    expect(readAdmission({ ...admission, assignments: [{ id: 'x' }] })).toBeNull();
    expect(readAdmission({ ...admission, discharge: { id: 'dsc_x' } })).toBeNull();
    expect(readAdmission(null)).toBeNull();
  });
});

describe('activeAssignment', () => {
  it('returns the unreleased assignment', () => {
    const parsed = readAdmission(admission)!;
    expect(activeAssignment(parsed)?.id).toBe('asg_example_9501');
  });

  it('returns null once every assignment is released', () => {
    const parsed = readAdmission({
      ...admission,
      assignments: [{ ...assignment, releasedAt: '2026-10-07T10:00:00.000Z' }],
    })!;
    expect(activeAssignment(parsed)).toBeNull();
  });
});

describe('extractAdmissionPage', () => {
  it('reads the unwrapped rows and total from the sibling meta', () => {
    const parsed = extractAdmissionPage([admission], { total: 1, page: 1, limit: 20 });
    expect(parsed.ok && parsed.page.rows[0]?.admissionNumber).toBe('ADM-2026-000001');
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('accepts an empty list and fails closed on a broken body', () => {
    expect(extractAdmissionPage([], undefined).ok && true).toBe(true);
    expect(extractAdmissionPage({ items: [] }, undefined)).toEqual({ ok: false });
    expect(extractAdmissionPage([{}], undefined)).toEqual({ ok: false });
    expect(extractAdmissionPage(null, undefined)).toEqual({ ok: false });
  });
});

describe('extractAdmissionRecord', () => {
  it('unwraps the { admission } body', () => {
    const parsed = extractAdmissionRecord({ admission });
    expect(parsed.ok && parsed.admission.id).toBe('adm_example_9001');
  });

  it('fails closed on a bare admission or a broken body', () => {
    expect(extractAdmissionRecord(admission)).toEqual({ ok: false });
    expect(extractAdmissionRecord({ admission: {} })).toEqual({ ok: false });
    expect(extractAdmissionRecord(null)).toEqual({ ok: false });
  });
});

describe('collectBeds', () => {
  it('flattens the ward tree into labelled bed options', () => {
    const parsed = readWard(ward)!;
    const beds = collectBeds([parsed]);
    expect(beds).toHaveLength(1);
    expect(beds[0]).toMatchObject({
      id: 'bed_example_4101',
      wardName: 'EXAMPLE Medical Ward',
      roomName: 'Room 101',
      bedNumber: '101-A',
      status: 'OCCUPIED',
    });
  });

  it('returns an empty list for no wards', () => {
    expect(collectBeds([])).toEqual([]);
  });
});
