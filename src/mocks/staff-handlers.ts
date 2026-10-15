import { http, HttpResponse } from 'msw';

import {
  ADMIN_STAFF,
  STAFF_BRANCHES,
  STAFF_DEPARTMENTS,
  type RegistryBranch,
  type RegistryStaff,
} from '@/mocks/fixtures/staff-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F9 staff directory handlers.
 *
 * State is a mutable clone of the fixture registry for the length of the mock
 * session: editing a profile or replacing assignments moves the same records the
 * workspace reads back. The guards mirror the service — every branch and
 * department id must exist or the whole assignment set is refused, and identity
 * is never editable here.
 */

type MutableStaff = {
  id: string;
  staffNumber: string;
  professionalTitle: string | null;
  specialization: string | null;
  employmentStatus: string;
  licenseNumber: string | null;
  user: RegistryStaff['user'];
  branchIds: string[];
  departmentIds: string[];
};

const staff: MutableStaff[] = ADMIN_STAFF.map((entry) => ({
  ...entry,
  user: { ...entry.user },
  branchIds: [...entry.branchIds],
  departmentIds: [...entry.departmentIds],
}));

const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'CONTRACT'];

function findStaff(id: string): MutableStaff | undefined {
  return staff.find((entry) => entry.id === id);
}

function findBranch(id: string): RegistryBranch | undefined {
  return STAFF_BRANCHES.find((branch) => branch.id === id);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArrayList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Serializes a profile with its joined branch and department refs. */
function serializeStaff(entry: MutableStaff) {
  return {
    id: entry.id,
    staffNumber: entry.staffNumber,
    professionalTitle: entry.professionalTitle,
    specialization: entry.specialization,
    employmentStatus: entry.employmentStatus,
    licenseNumber: entry.licenseNumber,
    user: { ...entry.user },
    branches: entry.branchIds.flatMap((id) => {
      const branch = findBranch(id);
      return branch ? [{ id: branch.id, name: branch.name, code: branch.code }] : [];
    }),
    departments: entry.departmentIds.flatMap((id) => {
      const department = STAFF_DEPARTMENTS.find((entry) => entry.id === id);
      return department ? [{ id: department.id, name: department.name }] : [];
    }),
  };
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

export function staffHandlers() {
  return [
    http.get('*/api/v1/staff', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20));

      const filtered = staff
        .filter((entry) => {
          if (!q) return true;
          const haystack = `${entry.staffNumber} ${entry.professionalTitle ?? ''} ${entry.specialization ?? ''} ${entry.user.firstName} ${entry.user.lastName} ${entry.user.email}`;
          return haystack.toLowerCase().includes(q);
        })
        .sort((a, b) => a.staffNumber.localeCompare(b.staffNumber));
      const rows = filtered.slice(0, limit).map(serializeStaff);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/staff/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const entry = findStaff(String(params.id));
      if (!entry) return notFound('Staff profile not found');
      return HttpResponse.json(apiOk({ staff: serializeStaff(entry) }));
    }),

    http.patch('*/api/v1/staff/:id', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const entry = findStaff(String(params.id));
      if (!entry) return notFound('Staff profile not found');
      const body = await readJson(request);
      if (!body) return validationError('bad json');

      if ('professionalTitle' in body) entry.professionalTitle = stringField(body.professionalTitle);
      if ('specialization' in body) entry.specialization = stringField(body.specialization);
      if ('licenseNumber' in body) entry.licenseNumber = stringField(body.licenseNumber);
      if (typeof body.employmentStatus === 'string' && EMPLOYMENT_STATUSES.includes(body.employmentStatus)) {
        entry.employmentStatus = body.employmentStatus;
      }
      return HttpResponse.json(apiOk({ staff: serializeStaff(entry) }));
    }),

    http.post('*/api/v1/staff/:id/assignments', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const entry = findStaff(String(params.id));
      if (!entry) return notFound('Staff profile not found');
      const body = await readJson(request);
      if (!body) return validationError('bad json');

      const branchIds = stringArrayList(body.branchIds);
      const departmentIds = stringArrayList(body.departmentIds);
      if (branchIds.some((id) => !findBranch(id))) {
        return validationError('One or more branches do not exist.');
      }
      if (departmentIds.some((id) => !STAFF_DEPARTMENTS.some((d) => d.id === id))) {
        return validationError('One or more departments do not exist.');
      }
      entry.branchIds = branchIds;
      entry.departmentIds = departmentIds;
      return HttpResponse.json(apiOk({ staff: serializeStaff(entry) }));
    }),

    http.get('*/api/v1/branches', async () => {
      await delay(MOCK_LATENCY_MS);
      const rows = STAFF_BRANCHES.map((branch) => ({ ...branch }));
      return HttpResponse.json(apiPage(rows, rows.length, 100));
    }),
  ];
}
