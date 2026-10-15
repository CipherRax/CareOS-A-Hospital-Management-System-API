import { ADMIN_USERS } from '@/mocks/fixtures/admin-registry';
import { DEPARTMENTS, type DepartmentFixture } from '@/mocks/fixtures/queue-registry';

/**
 * F9 staff directory fixtures.
 *
 * The staff profiles are derived from `ADMIN_USERS` so a directory row and its
 * user row cannot disagree on identity: every user carrying a staff profile
 * appears here, and only those. Branch and department *assignments* are held as
 * id lists and resolved to the serialized `{ id, name }` shapes on read, because
 * the API returns the joined refs from `userBranches` / `userDepartments`.
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same records and branch list are duplicated in `e2e/stub-api.mjs`.
 */

export interface RegistryBranch {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly operatingHours: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly createdAt: string;
}

export interface RegistryStaff {
  readonly id: string;
  readonly staffNumber: string;
  readonly professionalTitle: string | null;
  readonly specialization: string | null;
  readonly employmentStatus: string;
  readonly licenseNumber: string | null;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly status: string;
  };
  readonly branchIds: readonly string[];
  readonly departmentIds: readonly string[];
}

/** The organization's branches, addressed by `br_example_*`. */
export const STAFF_BRANCHES: readonly RegistryBranch[] = [
  {
    id: 'br_example_0001',
    name: 'EXAMPLE Main Campus',
    code: 'MAIN',
    address: 'EXAMPLE 12 Hospital Road, Nairobi',
    phone: '+254700100001',
    email: 'main@example.org',
    operatingHours: 'Mon–Sat 08:00–20:00',
    status: 'ACTIVE',
    createdAt: '2026-01-03T06:00:00.000Z',
  },
  {
    id: 'br_example_0002',
    name: 'EXAMPLE Westlands Clinic',
    code: 'WEST',
    address: 'EXAMPLE 5 Ring Road, Nairobi',
    phone: '+254700100002',
    email: 'westlands@example.org',
    operatingHours: 'Mon–Fri 08:00–17:00',
    status: 'ACTIVE',
    createdAt: '2026-02-01T06:00:00.000Z',
  },
];

/** Departments are the queue fixture set; the staff directory shares them. */
export const STAFF_DEPARTMENTS: readonly DepartmentFixture[] = DEPARTMENTS;

interface Assignment {
  readonly branchIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly licenseNumber: string | null;
}

/**
 * Assignment seed per staff id. Kept beside the profile rather than on the user
 * because the API stores assignments on `userBranches` / `userDepartments`, not
 * on the profile row.
 */
const ASSIGNMENTS: Record<string, Assignment> = {
  stf_example_0002: {
    branchIds: ['br_example_0001'],
    departmentIds: ['dep_example_outpatient'],
    licenseNumber: 'KMPDC-1234',
  },
  stf_example_0003: {
    branchIds: ['br_example_0001', 'br_example_0002'],
    departmentIds: ['dep_example_outpatient'],
    licenseNumber: null,
  },
  stf_example_0005: {
    branchIds: ['br_example_0002'],
    departmentIds: [],
    licenseNumber: null,
  },
  stf_example_0006: {
    branchIds: ['br_example_0001'],
    departmentIds: ['dep_example_outpatient', 'dep_example_emergency'],
    licenseNumber: 'KMLTTB-778',
  },
};

export const ADMIN_STAFF: readonly RegistryStaff[] = ADMIN_USERS.flatMap((user) => {
  if (!user.staff) return [];
  const assignment = ASSIGNMENTS[user.staff.id] ?? {
    branchIds: [],
    departmentIds: [],
    licenseNumber: null,
  };
  return [
    {
      id: user.staff.id,
      staffNumber: user.staff.staffNumber,
      professionalTitle: user.staff.professionalTitle,
      specialization: user.staff.specialization,
      employmentStatus: user.staff.employmentStatus,
      licenseNumber: assignment.licenseNumber,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
      },
      branchIds: assignment.branchIds,
      departmentIds: assignment.departmentIds,
    },
  ];
});
