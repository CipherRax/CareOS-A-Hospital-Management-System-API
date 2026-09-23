/**
 * Typed permission catalog (single source). Roles map to these strings;
 * guards check them; audits record them. Extend deliberately — every string
 * is a real capability boundary.
 */
export const PERMISSION_GROUPS = {
  organizations: {
    read: 'organizations.read',
    manage: 'organizations.manage',
  },
  branches: {
    read: 'branches.read',
    manage: 'branches.manage',
  },
  departments: {
    read: 'departments.read',
    manage: 'departments.manage',
  },
  users: {
    read: 'users.read',
    manage: 'users.manage',
  },
  roles: {
    read: 'roles.read',
    manage: 'roles.manage',
  },
  sessions: {
    read: 'sessions.read',
    manage: 'sessions.manage',
  },
  staff: {
    read: 'staff.read',
    manage: 'staff.manage',
  },
  breakGlass: {
    request: 'break_glass.request',
    manage: 'break_glass.manage',
  },
  documents: {
    read: 'documents.read',
    create: 'documents.create',
    manage: 'documents.manage',
  },
  patients: {
    read: 'patients.read',
    create: 'patients.create',
    update: 'patients.update',
    manage: 'patients.manage',
    merge: 'patients.merge',
  },
  appointments: {
    read: 'appointments.read',
    create: 'appointments.create',
    cancel: 'appointments.cancel',
  },
  clinicalNotes: {
    read: 'clinical_notes.read',
    create: 'clinical_notes.create',
  },
  diagnoses: {
    create: 'diagnosis.create',
  },
  prescriptions: {
    create: 'prescription.create',
    dispense: 'pharmacy.dispense',
  },
  lab: {
    order: 'lab.order',
    process: 'lab.process',
    verify: 'lab.verify',
  },
  pharmacy: {
    dispense: 'pharmacy.dispense',
    inventory: 'pharmacy.inventory',
  },
  billing: {
    read: 'billing.read',
    create: 'billing.create',
  },
  payments: {
    create: 'payments.create',
    refund: 'payments.refund',
  },
  reports: { read: 'reports.read' },
  audit: { read: 'audit.read' },
} as const;

export type Permission = string;

export const PERMISSION_LIST: readonly Permission[] = Object.values(
  PERMISSION_GROUPS,
).flatMap((group) => Object.values(group));

export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === 'string' && (PERMISSION_LIST as readonly string[]).includes(value)
  );
}
