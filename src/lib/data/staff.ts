import { publicEnv } from '@/lib/env';

import { EMPLOYMENT_STATUSES, type EmploymentStatus } from '@/lib/data/admin';
import type { DepartmentOption } from '@/lib/data/queue';
import {
  isRecord,
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Administration (F9 — the staff directory).
 *
 * `GET /staff` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), and the single-profile read types the bare
 * entity while the service answers `{ staff }`. Both therefore ride the
 * raw-fetch path and are validated structurally, so a body that drifts fails
 * closed rather than rendering an empty roster (which an administrator would read
 * as "no such person").
 *
 * A staff profile carries its user identity inline and its current branch and
 * department assignments. The assignments are replaced wholesale by
 * `POST /staff/{id}/assignments`; they are never patched field by field.
 */

export type StaffCallError = EnvelopeCallError;

export interface StaffUserRef {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: string;
}

export interface BranchOption {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly status: string;
}

export interface StaffRow {
  readonly id: string;
  readonly staffNumber: string;
  readonly professionalTitle: string | null;
  readonly specialization: string | null;
  readonly employmentStatus: EmploymentStatus;
  readonly licenseNumber: string | null;
  readonly user: StaffUserRef;
  readonly branches: readonly BranchOption[];
  readonly departments: readonly DepartmentOption[];
}

export interface StaffPage {
  readonly rows: readonly StaffRow[];
  readonly total: number;
}

export interface StaffQuery {
  readonly q?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface UpdateStaffInput {
  readonly id: string;
  readonly professionalTitle?: string | null;
  readonly specialization?: string | null;
  readonly employmentStatus?: EmploymentStatus;
  readonly licenseNumber?: string | null;
}

export interface SetStaffAssignmentsInput {
  readonly id: string;
  readonly branchIds: readonly string[];
  readonly departmentIds: readonly string[];
}

function readStaffUser(value: unknown): StaffUserRef | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.email !== 'string') return null;
  if (typeof value.firstName !== 'string' || typeof value.lastName !== 'string') return null;
  return {
    id: value.id,
    email: value.email,
    firstName: value.firstName,
    lastName: value.lastName,
    status: typeof value.status === 'string' ? value.status : 'ACTIVE',
  };
}

/** Reads one serialized branch; returns null when a required field has drifted. */
export function readBranchOption(value: unknown): BranchOption | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    code: typeof value.code === 'string' ? value.code : '',
    status: typeof value.status === 'string' ? value.status : 'ACTIVE',
  };
}

function readStaffDepartment(value: unknown): DepartmentOption | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    name: value.name,
    code: nullableString(value.code),
    active: typeof value.active === 'boolean' ? value.active : true,
  };
}

/** Reads one serialized staff profile; returns null when a required field has drifted. */
export function readStaff(value: unknown): StaffRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.staffNumber !== 'string') return null;
  const user = readStaffUser(value.user);
  if (!user) return null;

  const rawBranches = Array.isArray(value.branches) ? value.branches : [];
  const branches = rawBranches.map(readBranchOption);
  if (branches.some((branch) => branch === null)) return null;

  const rawDepartments = Array.isArray(value.departments) ? value.departments : [];
  const departments = rawDepartments.map(readStaffDepartment);
  if (departments.some((department) => department === null)) return null;

  return {
    id: value.id,
    staffNumber: value.staffNumber,
    professionalTitle: nullableString(value.professionalTitle),
    specialization: nullableString(value.specialization),
    employmentStatus:
      typeof value.employmentStatus === 'string' &&
      EMPLOYMENT_STATUSES.includes(value.employmentStatus as EmploymentStatus)
        ? (value.employmentStatus as EmploymentStatus)
        : 'ACTIVE',
    licenseNumber: nullableString(value.licenseNumber),
    user,
    branches: branches as readonly BranchOption[],
    departments: departments as readonly DepartmentOption[],
  };
}

/** Reads the staff page from the unwrapped `data` plus the sibling `meta`. */
export function extractStaffPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: StaffPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readStaff);
  if (rows.some((row) => row === null)) return { ok: false };
  return { ok: true, page: { rows: rows as readonly StaffRow[], total: pageTotal(meta, rows.length) } };
}

/** Reads a single-staff body: reads and writes answer `{ staff }`. */
export function extractStaffRecord(
  payload: unknown,
): { ok: true; staff: StaffRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const staff = readStaff(payload.staff);
  return staff ? { ok: true, staff } : { ok: false };
}

/** Reads the branch page from the unwrapped `data`. */
export function extractBranchList(
  data: unknown,
): { ok: true; branches: readonly BranchOption[] } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const branches = data.map(readBranchOption);
  if (branches.some((branch) => branch === null)) return { ok: false };
  return { ok: true, branches: branches as readonly BranchOption[] };
}

/** Raw read against `GET /staff?{filters}` (GAP-020: the 200 is the query DTO). */
export async function fetchStaff(query: StaffQuery = {}, signal?: AbortSignal): Promise<StaffPage> {
  const suffix = queryString({
    q: query.q,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/staff${suffix}`;
  return readEnvelope<StaffPage>(
    url,
    (data, meta) => {
      const page = extractStaffPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /staff/{id}` (the service answers `{ staff }`). */
export async function fetchStaffMember(id: string, signal?: AbortSignal): Promise<StaffRow> {
  const url = `${publicEnv.apiBasePath}/staff/${encodeURIComponent(id)}`;
  return readEnvelope<StaffRow>(
    url,
    (data) => {
      const parsed = extractStaffRecord(data);
      return parsed.ok ? { ok: true, value: parsed.staff } : { ok: false };
    },
    signal,
  );
}

/**
 * Raw read against `GET /branches`. The export types the 200 as a page even
 * though the service unwraps it into `data: [...]` (GAP-020 family), so the rows
 * are read structurally for the assignment picker.
 */
export async function fetchBranchOptions(signal?: AbortSignal): Promise<readonly BranchOption[]> {
  const url = `${publicEnv.apiBasePath}/branches?limit=100`;
  return readEnvelope<readonly BranchOption[]>(
    url,
    (data) => {
      const parsed = extractBranchList(data);
      return parsed.ok ? { ok: true, value: parsed.branches } : { ok: false };
    },
    signal,
  );
}
