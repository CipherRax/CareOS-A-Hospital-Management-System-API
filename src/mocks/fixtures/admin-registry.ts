import { INPATIENT_ORGANIZATION_ID } from '@/mocks/fixtures/inpatient-registry';

/**
 * F9 administration fixtures (users and roles).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same roster, roles and permission catalog are duplicated in `e2e/stub-api.mjs`
 * so mock dev and the production build's e2e run cannot silently drift.
 *
 * The roster walks every user status — INVITED, ACTIVE, SUSPENDED and
 * DEACTIVATED — so each tone and action on the directory is reachable, and
 * `usr_example_0001` matches the mock session persona (`EXAMPLE Nurse`).
 */

export type RegistryUserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface RegistryUserRole {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface RegistryUserStaff {
  readonly id: string;
  readonly staffNumber: string;
  readonly professionalTitle: string | null;
  readonly specialization: string | null;
  readonly employmentStatus: string;
}

export interface RegistryUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly otherNames: string | null;
  readonly phone: string | null;
  readonly status: RegistryUserStatus;
  readonly createdAt: string;
  readonly roles: readonly RegistryUserRole[];
  readonly staff: RegistryUserStaff | null;
}

export interface RegistryRole {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
  readonly createdAt: string;
}

export interface RegistryRoleTemplate {
  readonly key: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/** `{ groupKey: { action: permission } }`, exactly as the API serializes it. */
export type RegistryPermissionGroups = Record<string, Record<string, string>>;

export interface RegistryRoleCatalog {
  readonly groups: readonly RegistryRoleTemplate[];
  readonly systemRoles: readonly string[];
  readonly permissionGroups: RegistryPermissionGroups;
}

export const ADMIN_ORGANIZATION_ID = INPATIENT_ORGANIZATION_ID;
const CREATED = '2026-01-02T08:00:00.000Z';

function role(
  id: string,
  key: string,
  name: string,
  isSystem: boolean,
  permissions: readonly string[],
  description: string | null = null,
  createdAt = CREATED,
): RegistryRole {
  return { id, key, name, description, isSystem, permissions, createdAt };
}

export const ADMIN_ROLES: readonly RegistryRole[] = [
  role('rol_example_0001', 'SUPER_ADMIN', 'Super administrator', true, [
    'organizations.read',
    'organizations.manage',
    'users.read',
    'users.manage',
    'roles.read',
    'roles.manage',
    'sessions.manage',
    'staff.read',
    'staff.manage',
  ]),
  role('rol_example_0002', 'OWNER', 'Owner', true, [
    'organizations.read',
    'users.read',
    'users.manage',
    'roles.read',
    'roles.manage',
    'reports.read',
  ]),
  role('rol_example_0003', 'HOSPITAL_ADMIN', 'Hospital administrator', true, [
    'users.read',
    'users.manage',
    'roles.read',
    'staff.read',
    'staff.manage',
    'reports.read',
  ]),
  role(
    'rol_example_0004',
    'DOCTOR',
    'Doctor',
    false,
    [
      'patients.read',
      'encounters.read',
      'encounters.create',
      'clinical_notes.read',
      'clinical_notes.create',
      'prescriptions.read',
      'prescription.create',
      'lab.read',
      'radiology.read',
    ],
    'EXAMPLE clinical role.',
  ),
  role(
    'rol_example_0005',
    'NURSE',
    'Nurse',
    false,
    ['patients.read', 'vitals.read', 'vitals.record', 'queue.read', 'beds.read'],
    'EXAMPLE nursing role.',
  ),
  role(
    'rol_example_0006',
    'RECEPTIONIST',
    'Receptionist',
    false,
    [
      'patients.read',
      'patients.create',
      'appointments.read',
      'appointments.create',
      'queue.read',
      'queue.create',
    ],
    'EXAMPLE front-desk role.',
  ),
  role(
    'rol_example_0007',
    'PHARMACIST',
    'Pharmacist',
    false,
    ['prescription.read', 'pharmacy.dispense', 'pharmacy.inventory'],
    'EXAMPLE pharmacy role.',
  ),
  role(
    'rol_example_0008',
    'ACCOUNTANT',
    'Accountant',
    false,
    ['billing.read', 'billing.manage', 'insurance.read'],
    'EXAMPLE finance role.',
  ),
  role(
    'rol_example_0009',
    'LAB_TECHNICIAN',
    'Laboratory technician',
    false,
    ['lab.read', 'lab.process', 'lab.verify', 'lab.release'],
    'EXAMPLE laboratory role.',
  ),
];

function roleRef(key: string): RegistryUserRole {
  const found = ADMIN_ROLES.find((entry) => entry.key === key);
  if (!found) throw new Error(`Unknown role key: ${key}`);
  return { id: found.id, key: found.key, name: found.name };
}

function staffProfile(
  id: string,
  staffNumber: string,
  professionalTitle: string,
  specialization: string,
  employmentStatus: string,
): RegistryUserStaff {
  return { id, staffNumber, professionalTitle, specialization, employmentStatus };
}

export const ADMIN_USERS: readonly RegistryUser[] = [
  {
    id: 'usr_example_0001',
    email: 'nurse@example.org',
    firstName: 'EXAMPLE',
    lastName: 'Nurse',
    otherNames: null,
    phone: null,
    status: 'ACTIVE',
    createdAt: '2026-01-02T08:00:00.000Z',
    roles: [roleRef('NURSE')],
    staff: null,
  },
  {
    id: 'usr_example_0002',
    email: 'amina.example@careos.example',
    firstName: 'Amina',
    lastName: 'Odhiambo',
    otherNames: null,
    phone: '+254700000002',
    status: 'ACTIVE',
    createdAt: '2026-02-10T09:15:00.000Z',
    roles: [roleRef('DOCTOR')],
    staff: staffProfile(
      'stf_example_0002',
      'STF-0002',
      'Consultant Physician',
      'Internal Medicine',
      'ACTIVE',
    ),
  },
  {
    id: 'usr_example_0003',
    email: 'brian.example@careos.example',
    firstName: 'Brian',
    lastName: 'Kimani',
    otherNames: null,
    phone: '+254700000003',
    status: 'ACTIVE',
    createdAt: '2026-03-04T11:00:00.000Z',
    roles: [roleRef('RECEPTIONIST')],
    staff: staffProfile('stf_example_0003', 'STF-0003', 'Reception Supervisor', 'Front Office', 'ACTIVE'),
  },
  {
    id: 'usr_example_0004',
    email: 'cynthia.example@careos.example',
    firstName: 'Cynthia',
    lastName: 'Wanjiru',
    otherNames: 'Njeri',
    phone: null,
    status: 'INVITED',
    createdAt: '2026-03-20T14:30:00.000Z',
    roles: [roleRef('NURSE')],
    staff: null,
  },
  {
    id: 'usr_example_0005',
    email: 'daniel.example@careos.example',
    firstName: 'Daniel',
    lastName: 'Otieno',
    otherNames: null,
    phone: '+254700000005',
    status: 'SUSPENDED',
    createdAt: '2026-04-02T07:45:00.000Z',
    roles: [roleRef('ACCOUNTANT')],
    staff: staffProfile('stf_example_0005', 'STF-0005', 'Accounts Officer', 'Finance', 'ON_LEAVE'),
  },
  {
    id: 'usr_example_0006',
    email: 'esther.example@careos.example',
    firstName: 'Esther',
    lastName: 'Achieng',
    otherNames: null,
    phone: '+254700000006',
    status: 'ACTIVE',
    createdAt: '2026-04-19T10:10:00.000Z',
    roles: [roleRef('HOSPITAL_ADMIN'), roleRef('LAB_TECHNICIAN')],
    staff: staffProfile(
      'stf_example_0006',
      'STF-0006',
      'Laboratory Manager',
      'Haematology',
      'ACTIVE',
    ),
  },
  {
    id: 'usr_example_0007',
    email: 'felix.example@careos.example',
    firstName: 'Felix',
    lastName: 'Mutua',
    otherNames: null,
    phone: null,
    status: 'DEACTIVATED',
    createdAt: '2026-05-06T16:00:00.000Z',
    roles: [roleRef('PHARMACIST')],
    staff: null,
  },
];

/**
 * The permission catalog a role editor reads. Mirrors the API's
 * `GET /roles/permissions`: default role templates, the protected system role
 * keys, and the full `{ groupKey: { action: permission } }` map.
 */
export const ROLE_CATALOG: RegistryRoleCatalog = {
  groups: ADMIN_ROLES.map((entry) => ({
    key: entry.key,
    name: entry.name,
    permissions: [...entry.permissions],
  })),
  systemRoles: ADMIN_ROLES.filter((entry) => entry.isSystem).map((entry) => entry.key),
  permissionGroups: {
    organizations: { read: 'organizations.read', manage: 'organizations.manage' },
    branches: { read: 'branches.read', manage: 'branches.manage' },
    departments: { read: 'departments.read', manage: 'departments.manage' },
    users: { read: 'users.read', manage: 'users.manage' },
    roles: { read: 'roles.read', manage: 'roles.manage' },
    sessions: { read: 'sessions.read', manage: 'sessions.manage' },
    staff: { read: 'staff.read', manage: 'staff.manage' },
    patients: {
      read: 'patients.read',
      create: 'patients.create',
      update: 'patients.update',
      manage: 'patients.manage',
    },
    appointments: {
      read: 'appointments.read',
      create: 'appointments.create',
      manage: 'appointments.manage',
    },
    queue: { read: 'queue.read', create: 'queue.create', manage: 'queue.manage' },
    vitals: { read: 'vitals.read', record: 'vitals.record' },
    encounters: {
      read: 'encounters.read',
      create: 'encounters.create',
      update: 'encounters.update',
    },
    clinicalNotes: {
      read: 'clinical_notes.read',
      create: 'clinical_notes.create',
      update: 'clinical_notes.update',
    },
    prescriptions: {
      read: 'prescription.read',
      create: 'prescription.create',
      cancel: 'prescription.cancel',
    },
    lab: {
      read: 'lab.read',
      order: 'lab.order',
      process: 'lab.process',
      verify: 'lab.verify',
      release: 'lab.release',
    },
    radiology: {
      read: 'radiology.read',
      order: 'radiology.order',
      verify: 'radiology.verify',
      release: 'radiology.release',
    },
    pharmacy: { dispense: 'pharmacy.dispense', inventory: 'pharmacy.inventory' },
    inventory: { read: 'inventory.read', manage: 'inventory.manage', wastage: 'inventory.wastage' },
    billing: { read: 'billing.read', create: 'billing.create', manage: 'billing.manage' },
    insurance: { read: 'insurance.read', manage: 'insurance.manage' },
    wards: { read: 'wards.read', manage: 'wards.manage' },
    beds: { read: 'beds.read', manage: 'beds.manage' },
    inpatient: {
      read: 'inpatient.read',
      create: 'inpatient.create',
      transfer: 'inpatient.transfer',
      discharge: 'inpatient.discharge',
    },
    emergency: {
      read: 'emergency.read',
      register: 'emergency.register',
      triage: 'emergency.triage',
      manage: 'emergency.manage',
    },
    reports: { read: 'reports.read' },
    analytics: { read: 'analytics.read' },
    audit: { read: 'audit.read' },
  },
};
