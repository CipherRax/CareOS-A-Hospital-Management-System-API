import { describe, expect, it } from 'vitest';

import {
  extractBranchList,
  extractStaffPage,
  extractStaffRecord,
  readBranchOption,
  readStaff,
} from '@/lib/data/staff';

/**
 * F9 staff directory data layer.
 *
 * `GET /staff` types the 200 as the request DTO while the service answers a
 * `PageResult`, and the single read types the bare entity while the service
 * answers `{ staff }` (GAP-020 family). Both are validated structurally so a
 * drifted body fails closed.
 */

const staff = {
  id: 'stf_example_0002',
  staffNumber: 'STF-0002',
  professionalTitle: 'Consultant Physician',
  specialization: 'Internal Medicine',
  employmentStatus: 'ACTIVE',
  licenseNumber: 'KMPDC-1234',
  user: {
    id: 'usr_example_0002',
    email: 'amina.example@careos.example',
    firstName: 'Amina',
    lastName: 'Odhiambo',
    status: 'ACTIVE',
  },
  branches: [{ id: 'br_example_0001', name: 'EXAMPLE Main', code: 'MAIN', status: 'ACTIVE' }],
  departments: [{ id: 'dep_example_outpatient', name: 'EXAMPLE Outpatient' }],
};

describe('readStaff', () => {
  it('parses a serialized staff profile', () => {
    const row = readStaff(staff);
    expect(row?.staffNumber).toBe('STF-0002');
    expect(row?.user.email).toBe('amina.example@careos.example');
    expect(row?.branches[0]?.code).toBe('MAIN');
    expect(row?.departments[0]?.name).toBe('EXAMPLE Outpatient');
  });

  it('keeps an unassigned staff member', () => {
    const row = readStaff({ ...staff, branches: [], departments: [] });
    expect(row?.branches).toEqual([]);
    expect(row?.departments).toEqual([]);
  });

  it('defaults an unknown employment status to ACTIVE', () => {
    expect(readStaff({ ...staff, employmentStatus: 'RETIRED' })?.employmentStatus).toBe('ACTIVE');
  });

  it('rejects a drifted user', () => {
    expect(readStaff({ ...staff, user: { id: 'x' } })).toBeNull();
  });

  it('rejects a drifted branch row', () => {
    expect(readStaff({ ...staff, branches: [{ id: 'br_1' }] })).toBeNull();
  });

  it('rejects a non-record', () => {
    expect(readStaff('stf_example_0002')).toBeNull();
    expect(readStaff(null)).toBeNull();
  });
});

describe('readBranchOption', () => {
  it('parses a branch', () => {
    expect(readBranchOption({ id: 'br_1', name: 'Main', code: 'MAIN', status: 'ACTIVE' })).toEqual({
      id: 'br_1',
      name: 'Main',
      code: 'MAIN',
      status: 'ACTIVE',
    });
  });

  it('fails closed without an id or name', () => {
    expect(readBranchOption({ id: 'br_1' })).toBeNull();
    expect(readBranchOption({ name: 'Main' })).toBeNull();
  });
});

describe('extractStaffPage', () => {
  it('reads rows with the page total', () => {
    const result = extractStaffPage([staff], { total: 7 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page.rows).toHaveLength(1);
      expect(result.page.total).toBe(7);
    }
  });

  it('falls back to the row count without a total', () => {
    const result = extractStaffPage([staff], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.total).toBe(1);
  });

  it('fails closed when a row drifts', () => {
    expect(extractStaffPage([staff, { ...staff, staffNumber: 7 }], {}).ok).toBe(false);
  });

  it('fails closed when data is not an array', () => {
    expect(extractStaffPage({ staff: [staff] }, {}).ok).toBe(false);
  });
});

describe('extractStaffRecord', () => {
  it('unwraps a { staff } body', () => {
    const result = extractStaffRecord({ staff });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.staff.id).toBe('stf_example_0002');
  });

  it('fails closed without a staff profile', () => {
    expect(extractStaffRecord({}).ok).toBe(false);
  });
});

describe('extractBranchList', () => {
  it('reads the branch options', () => {
    const result = extractBranchList([{ id: 'br_1', name: 'Main', code: 'MAIN' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.branches).toHaveLength(1);
  });

  it('fails closed when data is not an array', () => {
    expect(extractBranchList({ branches: [] }).ok).toBe(false);
  });
});
