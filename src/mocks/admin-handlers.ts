import { http, HttpResponse } from 'msw';

import {
  ADMIN_ROLES,
  ADMIN_USERS,
  ROLE_CATALOG,
  type RegistryRole,
  type RegistryUser,
  type RegistryUserRole,
  type RegistryUserStatus,
} from '@/mocks/fixtures/admin-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F9 administration handlers (users and roles).
 *
 * State is a deep clone of the fixture registry, mutable for the length of the
 * mock session: inviting, editing, suspending, reactivating, re-roling and
 * revoking all move the same records the directory and the workspace read back.
 * The guards mirror the service — a duplicate email or staff number is a 409, the
 * calling user cannot manage itself, and a role set must reference real roles.
 */

type MutableUser = { -readonly [K in keyof RegistryUser]: RegistryUser[K] };
type MutableRole = { -readonly [K in keyof RegistryRole]: RegistryRole[K] };

/** The mock session persona; self-management is refused exactly as upstream. */
const CALLER_ID = 'usr_example_0001';

const users: MutableUser[] = ADMIN_USERS.map((user) => ({ ...user }));
const roles: MutableRole[] = ADMIN_ROLES.map((role) => ({ ...role }));
let userSeq = 8;
let roleSeq = 10;

const ROLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const USER_STATUSES: readonly RegistryUserStatus[] = [
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
];

function findUser(id: string): MutableUser | undefined {
  return users.find((user) => user.id === id);
}

function findRole(id: string): MutableRole | undefined {
  return roles.find((role) => role.id === id);
}

function notFound(message: string) {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
}

function validationError(message: string) {
  return HttpResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 });
}

function conflict(message: string) {
  return HttpResponse.json(apiError('CONFLICT', message), { status: 409 });
}

function permissionDenied(message: string) {
  return HttpResponse.json(apiError('PERMISSION_DENIED', message), { status: 403 });
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

function roleRef(role: MutableRole): RegistryUserRole {
  return { id: role.id, key: role.key, name: role.name };
}

/** Resolves a role-id list to unique role refs, or null when any id is unknown. */
function resolveRoles(roleIds: readonly string[]): RegistryUserRole[] | null {
  const refs: RegistryUserRole[] = [];
  const seen = new Set<string>();
  for (const id of roleIds) {
    if (seen.has(id)) continue;
    const role = findRole(id);
    if (!role) return null;
    refs.push(roleRef(role));
    seen.add(id);
  }
  return refs;
}

function stringArrayList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function adminHandlers() {
  return [
    http.get('*/api/v1/users', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20));

      const filtered = users
        .filter((user) => {
          if (status && user.status !== status) return false;
          if (q) {
            const haystack = `${user.email} ${user.firstName} ${user.otherNames ?? ''} ${user.lastName}`;
            if (!haystack.toLowerCase().includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.post('*/api/v1/users', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const email = stringField(body?.email);
      const firstName = stringField(body?.firstName);
      const lastName = stringField(body?.lastName);
      if (!email || !firstName || !lastName) {
        return validationError('Email, first name and last name are required.');
      }
      if (users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
        return conflict('A user with that email already exists.');
      }

      const staffInput = body?.staff;
      let staff = null;
      if (staffInput && typeof staffInput === 'object') {
        const staffRecord = staffInput as Record<string, unknown>;
        const staffNumber = stringField(staffRecord.staffNumber);
        if (!staffNumber) return validationError('A staff number is required.');
        if (users.some((user) => user.staff?.staffNumber === staffNumber)) {
          return conflict('A staff member with that number already exists.');
        }
        staff = {
          id: `stf_example_${userSeq}`,
          staffNumber,
          professionalTitle: stringField(staffRecord.professionalTitle),
          specialization: stringField(staffRecord.specialization),
          employmentStatus: stringField(staffRecord.employmentStatus) ?? 'ACTIVE',
        };
      }

      const roleIds = stringArrayList(body?.roleIds);
      const resolved = roleIds.length > 0 ? resolveRoles(roleIds) : [];
      if (resolved === null) return validationError('One or more roles do not exist.');

      const now = new Date().toISOString();
      const id = `usr_example_${String(userSeq).padStart(4, '0')}`;
      const user: MutableUser = {
        id,
        email,
        firstName,
        lastName,
        otherNames: stringField(body?.otherNames),
        phone: stringField(body?.phone),
        status: 'INVITED',
        createdAt: now,
        roles: resolved,
        staff,
      };
      users.push(user);
      userSeq += 1;
      return HttpResponse.json(
        apiOk({ user, inviteToken: `tok_example_${Math.random().toString(36).slice(2, 10)}` }),
        { status: 201 },
      );
    }),

    http.get('*/api/v1/roles', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20));

      const filtered = roles
        .filter((role) => {
          if (!q) return true;
          return `${role.name} ${role.key}`.toLowerCase().includes(q);
        })
        .sort((a, b) => {
          if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/roles/permissions', async () => {
      await delay(MOCK_LATENCY_MS);
      return HttpResponse.json(apiOk(ROLE_CATALOG));
    }),

    http.get('*/api/v1/roles/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const role = findRole(String(params.id));
      if (!role) return notFound('Role not found');
      return HttpResponse.json(apiOk({ role }));
    }),

    http.post('*/api/v1/roles', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const name = stringField(body?.name);
      const key = stringField(body?.key);
      const permissions = stringArrayList(body?.permissions);
      if (!name || !key) return validationError('Name and key are required.');
      if (!ROLE_KEY_PATTERN.test(key) || key.length > 48) {
        return validationError('The key must be uppercase letters, digits and underscores.');
      }
      if (permissions.length === 0) return validationError('At least one permission is required.');
      if (roles.some((role) => role.key === key || role.name === name)) {
        return conflict('A role with this key or name already exists.');
      }
      const now = new Date().toISOString();
      const role: MutableRole = {
        id: `rol_example_${String(roleSeq).padStart(4, '0')}`,
        key,
        name,
        description: stringField(body?.description),
        isSystem: false,
        permissions,
        createdAt: now,
      };
      roles.push(role);
      roleSeq += 1;
      return HttpResponse.json(apiOk({ role }), { status: 201 });
    }),

    http.patch('*/api/v1/roles/:id', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const id = String(params.id);
      const role = findRole(id);
      if (!role) return notFound('Role not found');
      const body = await readJson(request);
      if (!body) return validationError('bad json');
      if ('permissions' in body) {
        if (role.isSystem) {
          return permissionDenied('Only an administrator with full authority may edit a system role.');
        }
        const permissions = stringArrayList(body.permissions);
        if (permissions.length === 0) return validationError('At least one permission is required.');
        role.permissions = permissions;
      }
      if (typeof body.name === 'string' && body.name.length > 0 && body.name !== role.name) {
        if (roles.some((entry) => entry.id !== id && entry.name === body.name)) {
          return conflict('A role with this name already exists.');
        }
        role.name = body.name;
      }
      if ('description' in body) role.description = stringField(body.description);
      return HttpResponse.json(apiOk({ role }));
    }),

    http.delete('*/api/v1/roles/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const id = String(params.id);
      const role = findRole(id);
      if (!role) return notFound('Role not found');
      if (role.isSystem) {
        return permissionDenied('System roles cannot be deleted by this account.');
      }
      const assigned = users.some((user) => user.roles.some((ref) => ref.id === id));
      if (assigned) return conflict('Role is assigned to users; remove the assignments first.');
      roles.splice(roles.indexOf(role), 1);
      return new HttpResponse(null, { status: 204 });
    }),

    http.get('*/api/v1/users/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const user = findUser(String(params.id));
      if (!user) return notFound('User not found');
      return HttpResponse.json(apiOk({ user }));
    }),

    http.patch('*/api/v1/users/:id', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const id = String(params.id);
      const user = findUser(id);
      if (!user) return notFound('User not found');
      if (id === CALLER_ID) return validationError('Cannot self-manage through this endpoint.');

      const body = await readJson(request);
      if (!body) return validationError('bad json');
      if (typeof body.firstName === 'string') user.firstName = body.firstName;
      if (typeof body.lastName === 'string') user.lastName = body.lastName;
      if ('otherNames' in body) user.otherNames = stringField(body.otherNames);
      if ('phone' in body) user.phone = stringField(body.phone);
      if (typeof body.status === 'string' && USER_STATUSES.includes(body.status as RegistryUserStatus)) {
        user.status = body.status as RegistryUserStatus;
      }
      return HttpResponse.json(apiOk({ user }));
    }),

    http.post('*/api/v1/users/:id/roles', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const id = String(params.id);
      const user = findUser(id);
      if (!user) return notFound('User not found');
      const body = await readJson(request);
      const roleIds = stringArrayList(body?.roleIds);
      if (roleIds.length === 0) return validationError('At least one role is required.');
      const resolved = resolveRoles(roleIds);
      if (resolved === null) return validationError('One or more roles do not exist.');
      user.roles = resolved;
      return HttpResponse.json(apiOk({ user }));
    }),

    http.post('*/api/v1/users/:id/sessions/revoke', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const user = findUser(String(params.id));
      if (!user) return notFound('User not found');
      const revoked = user.status === 'ACTIVE' ? 2 : 0;
      return HttpResponse.json(apiOk({ revoked }));
    }),

    http.delete('*/api/v1/users/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const id = String(params.id);
      const user = findUser(id);
      if (!user) return notFound('User not found');
      if (id === CALLER_ID) return validationError('Cannot self-manage through this endpoint.');
      user.status = 'DEACTIVATED';
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
