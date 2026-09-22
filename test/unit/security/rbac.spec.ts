import {
  assertValidPermissions,
  canGrantRole,
  canManageSystemRole,
  isSystemRole,
  permissionUnion,
  type MinimalRole,
} from '../../../src/common/auth/rbac';
import {
  DEFAULT_ROLE_LIST,
  ROLE_KEYS,
  SYSTEM_ROLE_KEYS,
} from '../../../src/common/auth/role-matrix';
import { PERMISSION_LIST } from '../../../src/common/auth/permissions.catalog';

describe('rbac', () => {
  const adminRole: MinimalRole = {
    key: 'SUPER_ADMIN',
    permissions: [
      'organizations.read',
      'organizations.manage',
      'users.read',
      'users.manage',
      'roles.manage',
      'patients.read',
    ],
  };
  const limitedRole: MinimalRole = {
    key: 'NURSE',
    permissions: ['patients.read'],
  };

  describe('permissionUnion', () => {
    it('unions and de-duplicates role permissions', () => {
      const union = permissionUnion([
        { key: 'A', permissions: ['one', 'two'] },
        { key: 'B', permissions: ['two', 'three'] },
      ]);
      expect(union.sort()).toEqual(['one', 'three', 'two']);
    });
  });

  describe('canGrantRole (no privilege escalation)', () => {
    it('allows assigning a role whose permissions are a subset of the caller', () => {
      expect(canGrantRole(adminRole.permissions, ['users.read'])).toBe(true);
      expect(canGrantRole(adminRole.permissions, limitedRole.permissions)).toBe(true);
    });

    it('allows granting an empty set (no-op role)', () => {
      expect(canGrantRole(limitedRole.permissions, [])).toBe(true);
    });

    it('refuses a role with any permission the caller does not hold', () => {
      expect(canGrantRole(limitedRole.permissions, ['users.manage'])).toBe(false);
      expect(canGrantRole(adminRole.permissions, ['break_glass.manage'])).toBe(false);
    });
  });

  describe('canManageSystemRole', () => {
    it('requires the caller to hold every permission of the system role', () => {
      const sysRole: MinimalRole = {
        key: 'HOSPITAL_ADMIN',
        permissions: ['users.manage', 'roles.read'],
      };
      expect(canManageSystemRole(['users.manage', 'roles.read'], sysRole)).toBe(true);
      expect(canManageSystemRole(['users.manage'], sysRole)).toBe(false);
      expect(canManageSystemRole([], sysRole)).toBe(false);
    });
  });

  describe('assertValidPermissions', () => {
    it('accepts catalog permissions', () => {
      expect(() => assertValidPermissions(['users.read', 'reports.read'])).not.toThrow();
    });

    it('rejects unknown permissions', () => {
      expect(() => assertValidPermissions(['patients.hack_all'])).toThrow();
    });
  });

  describe('isSystemRole', () => {
    it('flags only the protected roles', () => {
      expect(isSystemRole({ key: 'SUPER_ADMIN' })).toBe(true);
      expect(isSystemRole({ key: 'OWNER' })).toBe(true);
      expect(isSystemRole({ key: 'HOSPITAL_ADMIN' })).toBe(true);
      expect(isSystemRole({ key: 'DOCTOR' })).toBe(false);
    });
  });
});

describe('role-matrix invariants', () => {
  it('every matrix role key is known and unique', () => {
    const keys = DEFAULT_ROLE_LIST.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_ROLE_LIST.length).toBeGreaterThanOrEqual(15);
    for (const key of keys) {
      expect(ROLE_KEYS).toContain(key);
    }
  });

  it('every permission in every role exists in the typed catalog', () => {
    const known = new Set(PERMISSION_LIST);
    for (const role of DEFAULT_ROLE_LIST) {
      for (const p of role.permissions) {
        expect(known.has(p)).toBe(true);
      }
    }
  });

  it('system roles exist in the protected set', () => {
    for (const key of SYSTEM_ROLE_KEYS) {
      expect(ROLE_KEYS).toContain(key);
    }
    const systemRoles = DEFAULT_ROLE_LIST.filter((r) => SYSTEM_ROLE_KEYS.has(r.key));
    expect(systemRoles.length).toBe(3);
  });

  it('no ordinary role absorbs the full SUPER_ADMIN permission set', () => {
    const admin = DEFAULT_ROLE_LIST.find((r) => r.key === 'SUPER_ADMIN')!;
    const supersets = DEFAULT_ROLE_LIST.filter(
      (r) =>
        r.key !== 'SUPER_ADMIN' &&
        admin.permissions.every((p) => r.permissions.includes(p)),
    );
    expect(supersets).toEqual([]);
  });
});
