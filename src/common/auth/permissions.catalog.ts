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
  schedules: {
    read: 'schedules.read',
    manage: 'schedules.manage',
  },
  appointments: {
    read: 'appointments.read',
    create: 'appointments.create',
    cancel: 'appointments.cancel',
    reschedule: 'appointments.reschedule',
    confirm: 'appointments.confirm',
    checkin: 'appointments.checkin',
    manage: 'appointments.manage',
  },
  waitlist: {
    read: 'waitlist.read',
    manage: 'waitlist.manage',
  },
  queue: {
    read: 'queue.read',
    create: 'queue.create',
    manage: 'queue.manage',
    prioritize: 'queue.prioritize',
  },
  visits: {
    read: 'visits.read',
    update: 'visits.update',
  },
  vitals: {
    read: 'vitals.read',
    record: 'vitals.record',
  },
  display: {
    devicesManage: 'display.devices.manage',
    // Device-scoped capability. Granted ONLY to display-device tokens via
    // DeviceAuthGuard; never assigned to staff roles.
    queueDisplay: 'queue.display',
  },
  clinicalNotes: {
    read: 'clinical_notes.read',
    create: 'clinical_notes.create',
    update: 'clinical_notes.update',
    manage: 'clinical_notes.manage',
  },
  diagnoses: {
    read: 'diagnosis.read',
    create: 'diagnosis.create',
    update: 'diagnosis.update',
    manage: 'diagnosis.manage',
  },
  encounters: {
    read: 'encounters.read',
    create: 'encounters.create',
    update: 'encounters.update',
    manage: 'encounters.manage',
  },
  followUps: {
    read: 'follow_ups.read',
    create: 'follow_ups.create',
    update: 'follow_ups.update',
  },
  referrals: {
    read: 'referrals.read',
    create: 'referrals.create',
    update: 'referrals.update',
  },
  tasks: {
    read: 'tasks.read',
    create: 'tasks.create',
    update: 'tasks.update',
  },
  workflows: {
    read: 'workflows.read',
    manage: 'workflows.manage',
  },
  codings: {
    read: 'coding.read',
    manage: 'coding.manage',
  },
  prescriptions: {
    read: 'prescription.read',
    create: 'prescription.create',
    update: 'prescription.update',
    cancel: 'prescription.cancel',
    dispense: 'pharmacy.dispense',
  },
  medications: {
    read: 'medications.read',
    manage: 'medications.manage',
  },
  suppliers: {
    read: 'suppliers.read',
    manage: 'suppliers.manage',
  },
  purchaseOrders: {
    read: 'purchase_orders.read',
    create: 'purchase_orders.create',
    approve: 'purchase_orders.approve',
    receive: 'purchase_orders.receive',
  },
  inventory: {
    read: 'inventory.read',
    manage: 'inventory.manage',
  },
  lab: {
    read: 'lab.read',
    order: 'lab.order',
    collect: 'lab.collect',
    process: 'lab.process',
    verify: 'lab.verify',
    release: 'lab.release',
    acknowledge: 'lab.acknowledge',
  },
  radiology: {
    read: 'radiology.read',
    order: 'radiology.order',
    process: 'radiology.process',
    verify: 'radiology.verify',
    release: 'radiology.release',
  },
  pharmacy: {
    dispense: 'pharmacy.dispense',
    inventory: 'pharmacy.inventory',
  },
  billing: {
    read: 'billing.read',
    create: 'billing.create',
    manage: 'billing.manage',
  },
  payments: {
    create: 'payments.create',
    refund: 'payments.refund',
  },
  insurance: {
    read: 'insurance.read',
    manage: 'insurance.manage',
  },
  reports: { read: 'reports.read' },
  audit: { read: 'audit.read' },
  wards: {
    read: 'wards.read',
    manage: 'wards.manage',
  },
  beds: {
    read: 'beds.read',
    manage: 'beds.manage',
  },
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
  // Communication & documents (brief Phase 9). Patient self-service uses
  // portal.read (granted only to the PATIENT role).
  notifications: {
    read: 'notifications.read',
    manage: 'notifications.manage',
  },
  messaging: {
    read: 'messaging.read',
    send: 'messaging.send',
    manage: 'messaging.manage',
  },
  telemedicine: {
    read: 'telemedicine.read',
    manage: 'telemedicine.manage',
  },
  feedback: {
    submit: 'feedback.submit',
    read: 'feedback.read',
    respond: 'feedback.respond',
  },
  complaints: {
    read: 'complaints.read',
    manage: 'complaints.manage',
  },
  incidents: {
    read: 'incidents.read',
    manage: 'incidents.manage',
  },
  portal: {
    read: 'portal.read',
  },
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
