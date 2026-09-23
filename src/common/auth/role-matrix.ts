import {
  PERMISSION_GROUPS,
  PERMISSION_LIST,
  type Permission,
} from './permissions.catalog';

/**
 * Default role matrix. Roles are seeded per-organization from this table and
 * stored as editable rows; system roles are protected. Every permission string
 * must exist in the typed catalog.
 */
export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'OWNER',
  'HOSPITAL_ADMIN',
  'DOCTOR',
  'CLINICAL_OFFICER',
  'NURSE',
  'PHARMACIST',
  'LAB_TECHNICIAN',
  'RADIOLOGY_TECHNICIAN',
  'RECEPTIONIST',
  'ACCOUNTANT',
  'RECORDS_OFFICER',
  'MANAGER',
  'AUDITOR',
  'PATIENT',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/** Marked roles can be updated/deleted only by a caller holding ALL permissions. */
export const SYSTEM_ROLE_KEYS: ReadonlySet<string> = new Set([
  'SUPER_ADMIN',
  'OWNER',
  'HOSPITAL_ADMIN',
]);

const G = PERMISSION_GROUPS;

const ALL = [
  G.organizations.read,
  G.organizations.manage,
  G.branches.read,
  G.branches.manage,
  G.departments.read,
  G.departments.manage,
  G.users.read,
  G.users.manage,
  G.roles.read,
  G.roles.manage,
  G.sessions.read,
  G.sessions.manage,
  G.staff.read,
  G.staff.manage,
  G.breakGlass.request,
  G.breakGlass.manage,
  G.documents.read,
  G.documents.create,
  G.documents.manage,
  G.patients.read,
  G.patients.create,
  G.patients.update,
  G.patients.manage,
  G.patients.merge,
  G.appointments.read,
  G.appointments.create,
  G.appointments.cancel,
  G.clinicalNotes.read,
  G.clinicalNotes.create,
  G.diagnoses.create,
  G.prescriptions.create,
  G.prescriptions.dispense,
  G.lab.order,
  G.lab.process,
  G.lab.verify,
  G.pharmacy.dispense,
  G.pharmacy.inventory,
  G.billing.read,
  G.billing.create,
  G.payments.create,
  G.payments.refund,
  G.reports.read,
  G.audit.read,
];

/**
 * Compile-time-ish invariant: every permission referenced by a matrix role must
 * exist in the typed catalog. Guards against typos in hand-written roles.
 */
for (const p of ALL) {
  if (!(PERMISSION_LIST as readonly string[]).includes(p)) {
    throw new Error(`Role matrix references unknown permission: ${p}`);
  }
}

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  permissions: Permission[];
}

export const DEFAULT_ROLE_MATRIX: Record<RoleKey, RoleDefinition> = {
  SUPER_ADMIN: {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full platform administration of the organization.',
    permissions: [...ALL],
  },
  OWNER: {
    key: 'OWNER',
    name: 'Owner',
    description: 'Organization owner. Everything except break-glass administration.',
    permissions: ALL.filter((p) => p !== G.breakGlass.manage),
  },
  HOSPITAL_ADMIN: {
    key: 'HOSPITAL_ADMIN',
    name: 'Hospital Admin',
    description:
      'Operational administrator: staff, users, branches, departments, access.',
    permissions: [
      G.organizations.read,
      G.branches.read,
      G.branches.manage,
      G.departments.read,
      G.departments.manage,
      G.users.read,
      G.users.manage,
      G.roles.read,
      G.sessions.read,
      G.sessions.manage,
      G.staff.read,
      G.staff.manage,
      G.breakGlass.manage,
      G.documents.read,
      G.documents.create,
      G.documents.manage,
      G.patients.read,
      G.patients.create,
      G.patients.update,
      G.patients.manage,
      G.patients.merge,
      G.reports.read,
      G.audit.read,
    ],
  },
  DOCTOR: {
    key: 'DOCTOR',
    name: 'Doctor',
    description: 'Physician: diagnoses, prescriptions, consultations.',
    permissions: [
      G.patients.read,
      G.patients.create,
      G.patients.update,
      G.appointments.read,
      G.appointments.create,
      G.appointments.cancel,
      G.clinicalNotes.read,
      G.clinicalNotes.create,
      G.diagnoses.create,
      G.prescriptions.create,
      G.lab.order,
      G.documents.read,
      G.documents.create,
      G.reports.read,
    ],
  },
  CLINICAL_OFFICER: {
    key: 'CLINICAL_OFFICER',
    name: 'Clinical Officer',
    description: 'Mid-level clinician: consultations and lab ordering.',
    permissions: [
      G.patients.read,
      G.patients.create,
      G.patients.update,
      G.appointments.read,
      G.appointments.create,
      G.appointments.cancel,
      G.clinicalNotes.read,
      G.clinicalNotes.create,
      G.lab.order,
      G.documents.read,
      G.documents.create,
      G.reports.read,
    ],
  },
  NURSE: {
    key: 'NURSE',
    name: 'Nurse',
    description: 'Triage, vital signs, nursing notes.',
    permissions: [
      G.patients.read,
      G.patients.update,
      G.appointments.read,
      G.appointments.create,
      G.clinicalNotes.read,
      G.clinicalNotes.create,
      G.lab.order,
      G.documents.read,
      G.documents.create,
      G.reports.read,
    ],
  },
  PHARMACIST: {
    key: 'PHARMACIST',
    name: 'Pharmacist',
    description: 'Dispensing and pharmacy inventory.',
    permissions: [
      G.patients.read,
      G.prescriptions.create,
      G.prescriptions.dispense,
      G.pharmacy.dispense,
      G.pharmacy.inventory,
      G.billing.read,
      G.documents.read,
      G.reports.read,
    ],
  },
  LAB_TECHNICIAN: {
    key: 'LAB_TECHNICIAN',
    name: 'Laboratory Technician',
    description: 'Processes lab orders and samples.',
    permissions: [G.patients.read, G.lab.order, G.lab.process, G.documents.read, G.reports.read],
  },
  RADIOLOGY_TECHNICIAN: {
    key: 'RADIOLOGY_TECHNICIAN',
    name: 'Radiology Technician',
    description: 'Imaging orders and acquisition.',
    permissions: [G.patients.read, G.lab.order, G.documents.read, G.reports.read],
  },
  RECEPTIONIST: {
    key: 'RECEPTIONIST',
    name: 'Receptionist',
    description: 'Registration, scheduling and desk cash.',
    permissions: [
      G.patients.read,
      G.patients.create,
      G.patients.update,
      G.appointments.read,
      G.appointments.create,
      G.appointments.cancel,
      G.billing.read,
      G.billing.create,
      G.payments.create,
      G.documents.read,
      G.documents.create,
      G.reports.read,
    ],
  },
  ACCOUNTANT: {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Billing, payments and refunds.',
    permissions: [
      G.patients.read,
      G.billing.read,
      G.billing.create,
      G.payments.create,
      G.payments.refund,
      G.reports.read,
      G.documents.read,
      G.audit.read,
    ],
  },
  RECORDS_OFFICER: {
    key: 'RECORDS_OFFICER',
    name: 'Records Officer',
    description: 'Medical records and demographics.',
    permissions: [
      G.patients.read,
      G.patients.create,
      G.patients.update,
      G.patients.merge,
      G.documents.read,
      G.reports.read,
    ],
  },
  MANAGER: {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Non-clinical departmental management and oversight.',
    permissions: [
      G.organizations.read,
      G.branches.read,
      G.departments.read,
      G.users.read,
      G.staff.read,
      G.patients.read,
      G.billing.read,
      G.documents.read,
      G.reports.read,
      G.audit.read,
    ],
  },
  AUDITOR: {
    key: 'AUDITOR',
    name: 'Auditor',
    description: 'Audit and reporting access (read-only).',
    permissions: [
      G.organizations.read,
      G.branches.read,
      G.departments.read,
      G.patients.read,
      G.billing.read,
      G.documents.read,
      G.reports.read,
      G.audit.read,
    ],
  },
  PATIENT: {
    key: 'PATIENT',
    name: 'Patient',
    description:
      'Self-service access to own records (self-scoping lands with the patient module).',
    permissions: [G.patients.read, G.documents.read, G.appointments.read],
  },
};

export const DEFAULT_ROLE_LIST: readonly RoleDefinition[] = ROLE_KEYS.map(
  (key) => DEFAULT_ROLE_MATRIX[key],
);
