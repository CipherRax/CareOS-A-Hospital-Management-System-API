import { isPermission } from './permissions.catalog';
import { SYSTEM_ROLE_KEYS } from './role-matrix';

export interface MinimalRole {
  key: string;
  permissions: string[];
  isSystem?: boolean;
}

/** Unions the permission lists of a set of roles, de-duplicated. */
export function permissionUnion(roles: readonly MinimalRole[]): string[] {
  const set = new Set<string>();
  for (const role of roles) {
    for (const permission of role.permissions) set.add(permission);
  }
  return [...set];
}

/** Is `subset` fully contained in `superset`? */
export function isSubset(
  subset: readonly string[],
  superset: readonly string[],
): boolean {
  const available = new Set(superset);
  return subset.every((p) => available.has(p));
}

/**
 * No-privilege-escalation rule. A caller may grant (assign, create or edit up
 * to) a role only when the role's permission set is within the caller's own
 * permission set. Otherwise a low-privilege administrator could mint a Doctor
 * or Admin for themselves.
 */
export function canGrantRole(
  callerPermissions: readonly string[],
  rolePermissions: readonly string[],
): boolean {
  return isSubset(rolePermissions, callerPermissions);
}

/**
 * System roles (SUPER_ADMIN/OWNER/HOSPITAL_ADMIN) may only be edited/deleted by
 * a caller who already holds the whole system role's permission set — a super
 * admin by construction (everything else fails the subset rule).
 */
export function canManageSystemRole(
  callerPermissions: readonly string[],
  systemRole: MinimalRole,
): boolean {
  return canGrantRole(callerPermissions, systemRole.permissions);
}

/** Validates that every string in a permission list is a known catalog permission. */
export function assertValidPermissions(permissions: readonly string[]): void {
  for (const permission of permissions) {
    if (!isPermission(permission)) {
      throw new Error(`Unknown permission in request: ${permission}`);
    }
  }
}

/** True when the caller holds all the listed permissions. */
export function hasAllPermissions(
  callerPermissions: readonly string[],
  required: readonly string[],
): boolean {
  return isSubset(required, callerPermissions);
}

/** Role is a protected system role? */
export function isSystemRole(role: Pick<MinimalRole, 'isSystem' | 'key'>): boolean {
  return role.isSystem === true || SYSTEM_ROLE_KEYS.has(role.key);
}
