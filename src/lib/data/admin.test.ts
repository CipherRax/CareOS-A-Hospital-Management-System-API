import { describe, expect, it } from 'vitest';

import {
  displayName,
  extractInvitedUser,
  extractRevoked,
  extractRolePage,
  extractRoleRecord,
  extractUserPage,
  extractUserRecord,
  isValidRoleKey,
  readRoleCatalog,
  readUser,
} from '@/lib/data/admin';

/**
 * F9 administration data layer.
 *
 * `GET /users` and `GET /roles` type the 200 as the request DTO while the
 * services answer a `PageResult`, and the single reads type the bare entity while
 * the services answer `{ user }` / `{ role }` (GAP-020 family). Each is validated
 * structurally so a drifted body fails closed rather than rendering an empty
 * roster an administrator would read as "no such person".
 */

const user = {
  id: 'usr_example_0001',
  email: 'amina.example@careos.example',
  firstName: 'Amina',
  lastName: 'Odhiambo',
  otherNames: null,
  phone: null,
  status: 'ACTIVE',
  createdAt: '2026-01-02T08:00:00.000Z',
  roles: [{ id: 'rol_example_0001', key: 'DOCTOR', name: 'Doctor' }],
  staff: {
    id: 'stf_example_0001',
    staffNumber: 'STF-0001',
    professionalTitle: 'Consultant Physician',
    specialization: 'Internal Medicine',
    employmentStatus: 'ACTIVE',
  },
};

const role = {
  id: 'rol_example_0001',
  key: 'DOCTOR',
  name: 'Doctor',
  description: 'EXAMPLE clinical role.',
  isSystem: false,
  permissions: ['patients.read', 'encounters.create'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('readUser', () => {
  it('parses a serialized user', () => {
    const row = readUser(user);
    expect(row?.email).toBe('amina.example@careos.example');
    expect(row?.status).toBe('ACTIVE');
    expect(row?.roles[0]?.key).toBe('DOCTOR');
    expect(row?.staff?.staffNumber).toBe('STF-0001');
  });

  it('keeps a user without a staff profile', () => {
    const row = readUser({ ...user, staff: null });
    expect(row?.staff).toBeNull();
  });

  it('rejects an unknown status', () => {
    expect(readUser({ ...user, status: 'PENDING' })).toBeNull();
  });

  it('rejects a drifted role', () => {
    expect(readUser({ ...user, roles: [{ id: 'x' }] })).toBeNull();
  });

  it('rejects a non-record', () => {
    expect(readUser('usr_example_0001')).toBeNull();
    expect(readUser(null)).toBeNull();
  });
});

describe('extractUserPage', () => {
  it('reads rows with the page total', () => {
    const result = extractUserPage([user], { total: 12 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page.rows).toHaveLength(1);
      expect(result.page.total).toBe(12);
    }
  });

  it('falls back to the row count without a total', () => {
    const result = extractUserPage([user], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.total).toBe(1);
  });

  it('fails closed when a row drifts', () => {
    expect(extractUserPage([user, { ...user, status: 'PENDING' }], { total: 2 }).ok).toBe(false);
  });

  it('fails closed when data is not an array', () => {
    expect(extractUserPage({ users: [user] }, {}).ok).toBe(false);
  });
});

describe('extractUserRecord', () => {
  it('unwraps a { user } body', () => {
    const result = extractUserRecord({ user });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.lastName).toBe('Odhiambo');
  });

  it('fails closed when the user is missing or drifted', () => {
    expect(extractUserRecord({}).ok).toBe(false);
    expect(extractUserRecord({ user: { ...user, id: 7 } }).ok).toBe(false);
  });
});

describe('extractInvitedUser', () => {
  it('reads the invite token when present', () => {
    const result = extractInvitedUser({ user, inviteToken: 'tok_example_123' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invited.user.id).toBe('usr_example_0001');
      expect(result.invited.inviteToken).toBe('tok_example_123');
    }
  });

  it('defaults a missing token to null', () => {
    const result = extractInvitedUser({ user });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invited.inviteToken).toBeNull();
  });

  it('fails closed without a user', () => {
    expect(extractInvitedUser({ inviteToken: 'x' }).ok).toBe(false);
  });
});

describe('extractRevoked', () => {
  it('reads the revoked count', () => {
    const result = extractRevoked({ revoked: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.revoked).toBe(3);
  });

  it('fails closed without a count', () => {
    expect(extractRevoked({}).ok).toBe(false);
    expect(extractRevoked(null).ok).toBe(false);
  });
});

describe('extractRolePage', () => {
  it('reads rows with the page total', () => {
    const result = extractRolePage([role], { total: 15 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page.rows).toHaveLength(1);
      expect(result.page.total).toBe(15);
    }
  });

  it('fails closed when a row drifts', () => {
    expect(extractRolePage([{ ...role, isSystem: undefined, key: 7 }], {}).ok).toBe(false);
  });
});

describe('extractRoleRecord', () => {
  it('unwraps a { role } body', () => {
    const result = extractRoleRecord({ role });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role.key).toBe('DOCTOR');
  });

  it('fails closed without a role', () => {
    expect(extractRoleRecord({}).ok).toBe(false);
  });
});

describe('readRoleCatalog', () => {
  it('flattens permission groups into ordered permission lists', () => {
    const catalog = readRoleCatalog({
      groups: [{ key: 'DOCTOR', name: 'Doctor', permissions: ['patients.read'] }],
      systemRoles: ['SUPER_ADMIN', 'OWNER', 'HOSPITAL_ADMIN'],
      permissionGroups: {
        users: { read: 'users.read', manage: 'users.manage' },
        roles: { read: 'roles.read' },
      },
    });
    expect(catalog?.systemRoles).toContain('SUPER_ADMIN');
    expect(catalog?.permissionGroups.map((group) => group.key)).toEqual(['roles', 'users']);
    expect(catalog?.permissionGroups[1]?.permissions).toEqual(['users.read', 'users.manage']);
  });

  it('tolerates a missing permissionGroups map', () => {
    const catalog = readRoleCatalog({ groups: [], systemRoles: [] });
    expect(catalog?.permissionGroups).toEqual([]);
  });

  it('fails closed when not a record', () => {
    expect(readRoleCatalog(null)).toBeNull();
  });
});

describe('displayName', () => {
  it('joins the name parts, skipping empties', () => {
    expect(displayName({ firstName: 'Amina', otherNames: 'A', lastName: 'Odhiambo' })).toBe(
      'Amina A Odhiambo',
    );
    expect(displayName({ firstName: 'Amina', otherNames: null, lastName: 'Odhiambo' })).toBe(
      'Amina Odhiambo',
    );
  });
});

describe('isValidRoleKey', () => {
  it('accepts the service key format', () => {
    expect(isValidRoleKey('DOCTOR')).toBe(true);
    expect(isValidRoleKey('LAB_TECHNICIAN')).toBe(true);
    expect(isValidRoleKey('ROLE_2')).toBe(true);
  });

  it('rejects a lowercase or punctuated key', () => {
    expect(isValidRoleKey('doctor')).toBe(false);
    expect(isValidRoleKey('Lab-Tech')).toBe(false);
    expect(isValidRoleKey('ROLE 2')).toBe(false);
    expect(isValidRoleKey('_ROLE')).toBe(false);
  });

  it('rejects an empty key and one over the length limit', () => {
    expect(isValidRoleKey('')).toBe(false);
    expect(isValidRoleKey(`A${'B'.repeat(48)}`)).toBe(false);
  });
});
