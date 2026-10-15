import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  stringArray,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Administration (F9 — users and roles).
 *
 * `GET /users` and `GET /roles` type their 200 as the request DTO while the
 * services answer a `PageResult` (GAP-020 family), and the single-resource reads
 * type the bare entity while the services answer `{ user }` / `{ role }`. Both
 * therefore ride the raw-fetch path and are validated structurally, so a body
 * that drifts fails closed rather than rendering an empty roster (which an
 * administrator would read as "no such person").
 *
 * No client-side branch picker exists (the session reports `branch.current:
 * null`), so invitation posts no branch unless one is given here (GAP-018).
 */

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'CONTRACT'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export interface UserRoleRef {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface UserStaffRef {
  readonly id: string;
  readonly staffNumber: string;
  readonly professionalTitle: string | null;
  readonly specialization: string | null;
  readonly employmentStatus: string;
}

export interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly otherNames: string | null;
  readonly phone: string | null;
  readonly status: UserStatus;
  readonly createdAt: string;
  readonly roles: readonly UserRoleRef[];
  readonly staff: UserStaffRef | null;
}

export interface UserPage {
  readonly rows: readonly UserRow[];
  readonly total: number;
}

export interface UserQuery {
  readonly status?: UserStatus;
  readonly q?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface CreateUserStaffInput {
  readonly staffNumber: string;
  readonly professionalTitle?: string;
  readonly specialization?: string;
  readonly employmentStatus?: EmploymentStatus;
  readonly licenseNumber?: string;
}

export interface InviteUserInput {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly otherNames?: string;
  readonly phone?: string;
  readonly roleIds?: readonly string[];
  readonly branchIds?: readonly string[];
  readonly departmentIds?: readonly string[];
  readonly staff?: CreateUserStaffInput;
}

export interface InvitedUser {
  readonly user: UserRow;
  readonly inviteToken: string | null;
}

export interface UpdateUserInput {
  readonly id: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly otherNames?: string | null;
  readonly phone?: string | null;
  readonly status?: UserStatus;
}

export interface SetUserRolesInput {
  readonly id: string;
  readonly roleIds: readonly string[];
}

export type AdminCallError = EnvelopeCallError;

// --- roles (read-only in this slice) ----------------------------------------

export interface RoleRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
  readonly createdAt: string;
}

export interface RolePage {
  readonly rows: readonly RoleRow[];
  readonly total: number;
}

export interface RoleQuery {
  readonly q?: string;
  readonly page?: number;
  readonly limit?: number;
}

/** One permission group from the catalog, flattened to action → permission. */
export interface PermissionGroup {
  readonly key: string;
  readonly permissions: readonly string[];
}

/** A default role template offered when building a custom role. */
export interface RoleTemplate {
  readonly key: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

export interface RoleCatalog {
  readonly groups: readonly RoleTemplate[];
  readonly systemRoles: readonly string[];
  readonly permissionGroups: readonly PermissionGroup[];
}

export function displayName(user: Pick<UserRow, 'firstName' | 'otherNames' | 'lastName'>): string {
  return [user.firstName, user.otherNames, user.lastName]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .trim();
}

function readUserRole(value: unknown): UserRoleRef | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.key !== 'string') return null;
  if (typeof value.name !== 'string') return null;
  return { id: value.id, key: value.key, name: value.name };
}

function readUserStaff(value: unknown): UserStaffRef | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.staffNumber !== 'string') return null;
  return {
    id: value.id,
    staffNumber: value.staffNumber,
    professionalTitle: nullableString(value.professionalTitle),
    specialization: nullableString(value.specialization),
    employmentStatus:
      typeof value.employmentStatus === 'string' ? value.employmentStatus : 'ACTIVE',
  };
}

/** Reads one serialized user; returns null when a required field has drifted. */
export function readUser(value: unknown): UserRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.email !== 'string') return null;
  if (typeof value.firstName !== 'string' || typeof value.lastName !== 'string') return null;
  if (typeof value.status !== 'string' || !USER_STATUSES.includes(value.status as UserStatus)) {
    return null;
  }
  const rawRoles = Array.isArray(value.roles) ? value.roles : [];
  const roles = rawRoles.map(readUserRole);
  if (roles.some((role) => role === null)) return null;
  const staff = value.staff == null ? null : readUserStaff(value.staff);
  if (value.staff != null && staff === null) return null;
  return {
    id: value.id,
    email: value.email,
    firstName: value.firstName,
    lastName: value.lastName,
    otherNames: nullableString(value.otherNames),
    phone: nullableString(value.phone),
    status: value.status as UserStatus,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    roles: roles as readonly UserRoleRef[],
    staff,
  };
}

function readRole(value: unknown): RoleRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.key !== 'string') return null;
  if (typeof value.name !== 'string') return null;
  return {
    id: value.id,
    key: value.key,
    name: value.name,
    description: nullableString(value.description),
    isSystem: value.isSystem === true,
    permissions: stringArray(value.permissions),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
  };
}

/** Reads the user page from the unwrapped `data` plus the sibling `meta`. */
export function extractUserPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: UserPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readUser);
  if (rows.some((row) => row === null)) return { ok: false };
  return { ok: true, page: { rows: rows as readonly UserRow[], total: pageTotal(meta, rows.length) } };
}

/** Reads the role page from the unwrapped `data` plus the sibling `meta`. */
export function extractRolePage(
  data: unknown,
  meta: unknown,
): { ok: true; page: RolePage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readRole);
  if (rows.some((row) => row === null)) return { ok: false };
  return { ok: true, page: { rows: rows as readonly RoleRow[], total: pageTotal(meta, rows.length) } };
}

/** Reads a single-user body: reads and writes answer `{ user }`. */
export function extractUserRecord(
  payload: unknown,
): { ok: true; user: UserRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const user = readUser(payload.user);
  return user ? { ok: true, user } : { ok: false };
}

/** The invite body carries `{ user, inviteToken? }`. */
export function extractInvitedUser(
  payload: unknown,
): { ok: true; invited: InvitedUser } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const user = readUser(payload.user);
  if (!user) return { ok: false };
  return {
    ok: true,
    invited: { user, inviteToken: nullableString(payload.inviteToken) },
  };
}

/** The session-revoke body carries `{ revoked }`. */
export function extractRevoked(
  payload: unknown,
): { ok: true; revoked: number } | { ok: false } {
  if (!isRecord(payload) || typeof payload.revoked !== 'number') return { ok: false };
  return { ok: true, revoked: payload.revoked };
}

function readTemplate(value: unknown): RoleTemplate | null {
  if (!isRecord(value)) return null;
  if (typeof value.key !== 'string' || typeof value.name !== 'string') return null;
  return { key: value.key, name: value.name, permissions: stringArray(value.permissions) };
}

/**
 * Reads the role/permission catalog body. `permissionGroups` arrives as
 * `{ groupKey: { action: permission } }`; each group is flattened to its list of
 * permission strings, ordered by key for a stable editor.
 */
export function readRoleCatalog(value: unknown): RoleCatalog | null {
  if (!isRecord(value)) return null;
  const rawGroups = Array.isArray(value.groups) ? value.groups : [];
  const groups = rawGroups.map(readTemplate);
  if (groups.some((group) => group === null)) return null;

  const permissionGroups: PermissionGroup[] = [];
  if (isRecord(value.permissionGroups)) {
    for (const [key, actions] of Object.entries(value.permissionGroups)) {
      if (!isRecord(actions)) continue;
      const permissions = Object.values(actions).filter(
        (permission): permission is string => typeof permission === 'string',
      );
      permissionGroups.push({ key, permissions });
    }
  }
  permissionGroups.sort((a, b) => a.key.localeCompare(b.key));

  return {
    groups: groups as readonly RoleTemplate[],
    systemRoles: stringArray(value.systemRoles),
    permissionGroups,
  };
}

/** Reads a single-role body: reads and writes answer `{ role }`. */
export function extractRoleRecord(
  payload: unknown,
): { ok: true; role: RoleRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const role = readRole(payload.role);
  return role ? { ok: true, role } : { ok: false };
}

/** Raw read against `GET /users?{filters}` (GAP-020: the 200 is the query DTO). */
export async function fetchUsers(query: UserQuery = {}, signal?: AbortSignal): Promise<UserPage> {
  const suffix = queryString({
    status: query.status,
    q: query.q,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/users${suffix}`;
  return readEnvelope<UserPage>(
    url,
    (data, meta) => {
      const page = extractUserPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /users/{id}` (the service answers `{ user }`). */
export async function fetchUser(id: string, signal?: AbortSignal): Promise<UserRow> {
  const url = `${publicEnv.apiBasePath}/users/${encodeURIComponent(id)}`;
  return readEnvelope<UserRow>(
    url,
    (data) => {
      const parsed = extractUserRecord(data);
      return parsed.ok ? { ok: true, value: parsed.user } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /roles?{filters}` (GAP-020: the 200 is the query DTO). */
export async function fetchRoles(query: RoleQuery = {}, signal?: AbortSignal): Promise<RolePage> {
  const suffix = queryString({
    q: query.q,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/roles${suffix}`;
  return readEnvelope<RolePage>(
    url,
    (data, meta) => {
      const page = extractRolePage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /roles/permissions` (the catalog body). */
export async function fetchRoleCatalog(signal?: AbortSignal): Promise<RoleCatalog> {
  const url = `${publicEnv.apiBasePath}/roles/permissions`;
  return readEnvelope<RoleCatalog>(
    url,
    (data) => {
      const catalog = readRoleCatalog(data);
      return catalog ? { ok: true, value: catalog } : { ok: false };
    },
    signal,
  );
}
