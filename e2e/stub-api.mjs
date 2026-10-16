/**
 * Stub upstream API for end-to-end tests.
 *
 * The frontend reaches the API through the real `/api/v1` proxy, so without
 * something at the other end `/auth/me` fails and the staff gate — correctly —
 * renders its signed-out page. That would leave the signed-in staff shell with no
 * automated accessibility coverage at all, which is a worse state than having no
 * gate, so the tests stand up this stub instead of weakening the gate.
 *
 * It is a real HTTP server, not a `fetch` stub, so the proxy, cookie handling and
 * error envelope are all genuinely exercised.
 *
 * It answers only the paths the app actually uses, modelled on the exported
 * `openapi/careos.openapi.json` (not the retired partial document). Every other
 * path 404s, so a test that accidentally starts depending on more of the API
 * fails loudly rather than quietly passing against invented data.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_API_PORT ?? 3199);

/**
 * The signed-in persona. Everything here is fabricated on a real envelope.
 *
 * `/auth/me` returns `data` in the live shape (`user` + `roles`/`roleDetails`,
 * `organization`, `security`, `session`, …) so the frontend's `normaliseSessionUser`
 * has a real body to read. Login returns the token pair *in the response body* —
 * this stub sits *upstream* of the proxy, and the proxy is what lifts the pair
 * into HttpOnly cookies and strips it from what the browser sees. The header then
 * reads `EXAMPLE Dr N. Wanjiru` (firstName + otherNames + lastName).
 */
const USER = {
  user: {
    id: 'usr-example-1',
    email: 'registrar@example.org',
    firstName: 'EXAMPLE Dr',
    otherNames: 'N.',
    lastName: 'Wanjiru',
    status: 'ACTIVE',
  },
  roles: [{ id: 'role-example-1', key: 'REGISTRAR', name: 'Registrar' }],
  roleDetails: [{ id: 'role-example-1', key: 'REGISTRAR', name: 'Registrar' }],
  organization: {
    id: 'org-example-1',
    name: 'EXAMPLE Teaching Hospital',
    status: 'ACTIVE',
    currency: 'KES',
    featureFlags: {},
  },
  security: { passwordChangeRequired: false, mfaEnrolmentRequired: false, staging: [] },
  session: { id: 'ses-example-1', familyId: 'fam-example-1' },
  branch: { current: null, allowed: [] },
  branches: [],
  patient: null,
  preferences: null,
};

const SESSION = {
  id: 'ses-example-1',
  familyId: 'fam-example-1',
  createdAt: '2026-09-27T09:00:00.000Z',
  expiresAt: '2026-09-28T09:00:00.000Z',
};

/** The only token pair the stub accepts. The proxy mirrors it into cookies. */
const TOKENS = {
  accessToken: 'careos-e2e-access-token',
  refreshToken: 'careos-e2e-refresh-token',
  expiresIn: 900,
  refreshTokenExpiresAt: '2026-12-31T00:00:00.000Z',
};

/**
 * The MFA-secured persona. Login for this account answers with a single-use
 * challenge and no tokens; `POST /auth/mfa/verify` completes it (code 123456 or
 * the recovery code `RECOVERY-RSTV-4AK3-9M`) and returns the same session
 * envelope a non-MFA login would, so the proxy lifts the pair exactly as it
 * does for `/auth/login`.
 */
const MFA_EMAIL = 'mfa@example.org';
const MFA_CHALLENGE_TOKEN = 'careos-e2e-mfa-challenge';
const MFA_CODE = '123456';
const MFA_RECOVERY_CODE = 'RECOVERY-RSTV-4AK3-9M';

const PATIENT_REGISTRY = {
  'pat_example_1001': {
    id: 'pat_example_1001',
    patientNumber: 'PAT-2026-000001',
    firstName: 'EXAMPLE',
    otherNames: 'Amina',
    lastName: 'Yusuf',
    dateOfBirth: '1992-05-14',
    sex: 'FEMALE',
    phone: '0700000001',
    county: 'Mombasa',
    town: 'Old Town',
    status: 'ACTIVE',
    version: 1,
  },
  'pat_example_1002': {
    id: 'pat_example_1002',
    patientNumber: 'PAT-2026-000002',
    firstName: 'EXAMPLE',
    otherNames: null,
    lastName: 'Mwangi',
    dateOfBirth: '1987-03-20',
    sex: 'MALE',
    phone: '0700000002',
    county: 'Nairobi',
    town: 'Kilimani',
    status: 'ACTIVE',
    version: 1,
  },
  'pat_example_1003': {
    id: 'pat_example_1003',
    patientNumber: 'PAT-2026-000003',
    firstName: 'EXAMPLE',
    otherNames: 'Muthoni',
    lastName: 'Wambui',
    dateOfBirth: '1975-11-09',
    sex: 'FEMALE',
    phone: '0700000003',
    county: 'Kiambu',
    town: 'Thika',
    status: 'ACTIVE',
    version: 1,
  },
  'pat_example_1004': {
    id: 'pat_example_1004',
    patientNumber: 'PAT-2026-000004',
    firstName: 'EXAMPLE',
    otherNames: null,
    lastName: 'Njoroge',
    dateOfBirth: '1995-02-18',
    sex: 'MALE',
    phone: '0700000004',
    county: 'Nairobi',
    town: 'Riverside',
    status: 'ACTIVE',
    version: 1,
  },
};
let createdSeq = 5;

const SECTIONS = {
  pat_example_1001: {
    guardians: [
      { id: 'g-1001-1', firstName: 'EXAMPLE', lastName: 'Hasan', relationship: 'Guardian', phone: '0700000002', isEmergencyContact: true },
    ],
    consents: [{ type: 'TREATMENT', status: 'GRANTED' }],
    allergies: [{ id: 'a-1001-1', substance: 'Penicillin', severity: 'SEVERE' }],
    medicalHistory: [{ category: 'DIABETES', description: 'Type 2', onsetDate: '2018-06-01' }],
  },
};
const TIMELINE = {
  pat_example_1001: [
    { id: 't-1001-1', occurredAt: '2026-10-05T09:00:00Z', title: 'Registered', type: 'PATIENT_CREATED' },
  ],
};
const ACCESS_LOG = {
  pat_example_1001: [
    {
      id: 'al-1001-1',
      patientId: 'pat_example_1001',
      userId: 'usr-example-1',
      action: 'VIEW',
      section: 'MASTER',
      reason: 'INCLINIC_VIEW',
      ip: '127.0.0.1',
      userAgent: 'stub',
      requestId: 'r-1',
      createdAt: '2026-10-05T09:05:00Z',
    },
  ],
};

/** F3 queue fixtures. Offsets are stamped against the clock at call time. */
const QUEUE_BRANCH_ID = 'br_example_0001';
const DEPARTMENTS = [
  { id: 'dep_example_outpatient', name: 'EXAMPLE Outpatient', code: 'OPD', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
  { id: 'dep_example_emergency', name: 'EXAMPLE Emergency', code: 'EMG', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
  { id: 'dep_example_paediatrics', name: 'EXAMPLE Paediatrics', code: 'PED', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
  { id: 'dep_example_maternity', name: 'EXAMPLE Maternity', code: 'MAT', kind: 'STANDARD', active: true, createdAt: '2026-01-04T06:00:00.000Z' },
];
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const QUEUE = [
  { id: 'qe_example_2001', ticketNumber: 'Q-001', patientId: 'pat_example_1003', patient: 'EXAMPLE Muthoni Wambui', visitId: 'vis_example_3001', departmentId: 'dep_example_emergency', branchId: QUEUE_BRANCH_ID, status: 'WAITING', operationalPriority: 'URGENT', enteredAt: minutesAgo(24), calledAt: null, serviceStartedAt: null, completedAt: null, note: 'Chest pain, triaged by nurse.' },
  { id: 'qe_example_2002', ticketNumber: 'Q-002', patientId: 'pat_example_1002', patient: 'EXAMPLE Mwangi', visitId: 'vis_example_3002', departmentId: 'dep_example_outpatient', branchId: QUEUE_BRANCH_ID, status: 'CALLED', operationalPriority: 'HIGH', enteredAt: minutesAgo(41), calledAt: minutesAgo(3), serviceStartedAt: null, completedAt: null, note: null },
  { id: 'qe_example_2003', ticketNumber: 'Q-003', patientId: 'pat_example_1001', patient: 'EXAMPLE Amina Yusuf', visitId: 'vis_example_3003', departmentId: 'dep_example_outpatient', branchId: QUEUE_BRANCH_ID, status: 'WAITING', operationalPriority: 'NORMAL', enteredAt: minutesAgo(12), calledAt: null, serviceStartedAt: null, completedAt: null, note: null },
  { id: 'qe_example_2004', ticketNumber: 'Q-004', patientId: 'pat_example_1002', patient: 'EXAMPLE Mwangi', visitId: 'vis_example_3004', departmentId: 'dep_example_paediatrics', branchId: QUEUE_BRANCH_ID, status: 'IN_SERVICE', operationalPriority: 'NORMAL', enteredAt: minutesAgo(63), calledAt: minutesAgo(52), serviceStartedAt: minutesAgo(49), completedAt: null, note: null },
  { id: 'qe_example_2005', ticketNumber: 'Q-005', patientId: 'pat_example_1003', patient: 'EXAMPLE Muthoni Wambui', visitId: 'vis_example_3005', departmentId: 'dep_example_outpatient', branchId: QUEUE_BRANCH_ID, status: 'COMPLETED', operationalPriority: 'NORMAL', enteredAt: minutesAgo(120), calledAt: minutesAgo(95), serviceStartedAt: minutesAgo(92), completedAt: minutesAgo(70), note: null },
  { id: 'qe_example_2006', ticketNumber: 'Q-006', patientId: 'pat_example_1002', patient: 'EXAMPLE Mwangi', visitId: 'vis_example_3006', departmentId: 'dep_example_maternity', branchId: QUEUE_BRANCH_ID, status: 'NO_SHOW', operationalPriority: 'LOW', enteredAt: minutesAgo(88), calledAt: minutesAgo(60), serviceStartedAt: null, completedAt: null, note: 'Did not answer the call.' },
];
const QUEUE_TRANSITIONS = {
  WAITING: ['CALLED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED'],
  CALLED: ['IN_SERVICE', 'WAITING', 'NO_SHOW', 'CANCELLED', 'TRANSFERRED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED', 'TRANSFERRED'],
  COMPLETED: [], NO_SHOW: [], ABANDONED: [], CANCELLED: [], TRANSFERRED: [],
};
const QUEUE_ACTIVE = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);
let ticketSeq = 7;

/** F3 scheduling fixtures. Same records as the MSW handlers. */
const SCHEDULING_BRANCH_ID = 'br_example_0001';
const PROVIDER_DIRECTORY = [
  { id: 'usr_example_9101', name: 'EXAMPLE Dr N. Wanjiru', bookable: true, specialization: 'Internal Medicine', professionalTitle: 'Consultant Physician', departmentIds: ['dep_example_outpatient'], branchIds: [SCHEDULING_BRANCH_ID], status: 'ACTIVE' },
  { id: 'usr_example_9102', name: 'EXAMPLE Dr O. Mwangi', bookable: true, specialization: 'Paediatrics', professionalTitle: 'Paediatrician', departmentIds: ['dep_example_outpatient', 'dep_example_paediatrics'], branchIds: [SCHEDULING_BRANCH_ID], status: 'ACTIVE' },
  { id: 'usr_example_9103', name: 'EXAMPLE Dr A. Otieno', bookable: true, specialization: 'Emergency Medicine', professionalTitle: 'Emergency Physician', departmentIds: ['dep_example_emergency'], branchIds: [SCHEDULING_BRANCH_ID], status: 'ACTIVE' },
  { id: 'usr_example_9104', name: 'EXAMPLE Dr F. Hassan', bookable: true, specialization: 'Obstetrics', professionalTitle: 'Obstetrician', departmentIds: ['dep_example_maternity'], branchIds: [SCHEDULING_BRANCH_ID], status: 'ACTIVE' },
];
const SCHEDULE_TEMPLATES = [];
for (const provider of PROVIDER_DIRECTORY) {
  for (const dayOfWeek of [0, 1, 2, 3, 4]) {
    SCHEDULE_TEMPLATES.push({ id: `sch_example_${800 + SCHEDULE_TEMPLATES.length}`, providerId: provider.id, branchId: SCHEDULING_BRANCH_ID, departmentId: provider.departmentIds[0], dayOfWeek, startMinutes: 480, endMinutes: 780, slotDurationMinutes: 30, capacity: 1, isAvailable: true, note: null });
  }
}
const LIVE_OVERRIDES = [];
let templateSeq = 800 + SCHEDULE_TEMPLATES.length;
let overrideSeq = 900;
const APPOINTMENT_SEED = [
  { id: 'apt_example_4001', patientId: 'pat_example_1001', providerId: 'usr_example_9101', departmentId: 'dep_example_outpatient', mode: 'IN_PERSON', appointmentType: 'Follow-up', reason: 'Blood pressure review.', status: 'CONFIRMED', startMinutes: 540 },
  { id: 'apt_example_4002', patientId: 'pat_example_1002', providerId: 'usr_example_9101', departmentId: 'dep_example_outpatient', mode: 'IN_PERSON', appointmentType: 'New patient', reason: 'Knee pain, referred by physiotherapy.', status: 'BOOKED', startMinutes: 600 },
  { id: 'apt_example_4003', patientId: 'pat_example_1003', providerId: 'usr_example_9102', departmentId: 'dep_example_paediatrics', mode: 'IN_PERSON', appointmentType: 'Vaccination', reason: null, status: 'CHECKED_IN', startMinutes: 570 },
  { id: 'apt_example_4004', patientId: 'pat_example_1004', providerId: 'usr_example_9101', departmentId: 'dep_example_outpatient', mode: 'VIRTUAL', appointmentType: 'Review', reason: 'Telephone review of results.', status: 'COMPLETED', startMinutes: 480 },
  { id: 'apt_example_4005', patientId: 'pat_example_1002', providerId: 'usr_example_9103', departmentId: 'dep_example_emergency', mode: 'IN_PERSON', appointmentType: null, reason: 'Wound check.', status: 'NO_SHOW', startMinutes: 660 },
];
const WAITLIST_SEED = [
  { id: 'wl_example_5001', patientId: 'pat_example_1002', providerId: null, departmentId: 'dep_example_outpatient', status: 'WAITING', offerMinutes: null, notes: 'Prefers mornings.' },
  { id: 'wl_example_5002', patientId: 'pat_example_1004', providerId: 'usr_example_9101', departmentId: 'dep_example_outpatient', status: 'OFFERED', offerMinutes: 720, notes: null },
  { id: 'wl_example_5003', patientId: 'pat_example_1003', providerId: null, departmentId: 'dep_example_maternity', status: 'WAITING', offerMinutes: null, notes: 'Needs an interpreter.' },
];
const APPOINTMENT_TRANSITIONS = {
  BOOKED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [], RESCHEDULED: [],
};
const APPOINTMENT_OCCUPYING = new Set(['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS']);
const ACTIONABLE_WAITLIST = new Set(['WAITING', 'OFFERED']);

function utcDayStart(dateISO) {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
function todayISO() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}
function businessDayKey(iso) {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function workdayIndexFor(date) {
  return (date.getUTCDay() + 6) % 7;
}

function buildAppointments() {
  const day = utcDayStart(todayISO()).getTime();
  return APPOINTMENT_SEED.map((seed) => {
    const startsAt = new Date(day + seed.startMinutes * 60000).toISOString();
    return {
      id: seed.id, organizationId: 'org_example_0001', branchId: SCHEDULING_BRANCH_ID, departmentId: seed.departmentId,
      patientId: seed.patientId, providerId: seed.providerId, startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60000).toISOString(),
      mode: seed.mode, appointmentType: seed.appointmentType, reason: seed.reason, status: seed.status, version: 1,
      checkedInAt: null, inProgressAt: null, completedAt: seed.status === 'COMPLETED' ? startsAt : null,
      noShowAt: seed.status === 'NO_SHOW' ? startsAt : null, cancelledAt: null, cancelReason: null,
      rescheduledFromId: null, rescheduledToId: null, rescheduledAt: null, createdAt: startsAt, updatedAt: startsAt,
    };
  });
}
function buildWaitlist() {
  const day = utcDayStart(todayISO()).getTime();
  return WAITLIST_SEED.map((seed) => {
    const offeredStartAt = seed.offerMinutes == null ? null : new Date(day + seed.offerMinutes * 60000).toISOString();
    return {
      id: seed.id, branchId: SCHEDULING_BRANCH_ID, departmentId: seed.departmentId, patientId: seed.patientId,
      providerId: seed.providerId, status: seed.status, offeredAt: offeredStartAt ? new Date(day - 3600000).toISOString() : null,
      offerExpiresAt: offeredStartAt ? new Date(day + 86400000).toISOString() : null, offeredStartAt,
      acceptedAppointmentId: null, resolvedAt: null, preferredDate: null, notes: seed.notes,
      createdAt: new Date(day - 7200000).toISOString(), updatedAt: new Date(day).toISOString(),
    };
  });
}
const APPOINTMENTS = buildAppointments();
const LIVE_WAITLIST = buildWaitlist();
let appointmentSeq = 6;
let waitlistSeq = 4;

/** F3 vitals fixtures. Same records as the MSW handlers. */
const VITAL_SEED = [
  { id: 'vr_example_7001', patientId: 'pat_example_1001', visitId: 'vis_example_3001', minutesAgo: 180, temperatureC: 38.9, systolicMmHg: 132, diastolicMmHg: 84, pulseBpm: 96, respiratoryRate: 20, spo2: 94, weightKg: null, heightCm: null, painScore: 4, notes: 'Presented febrile.', correctionOfId: null, correctionReason: null },
  { id: 'vr_example_7002', patientId: 'pat_example_1001', visitId: 'vis_example_3001', minutesAgo: 175, temperatureC: 37.2, systolicMmHg: 128, diastolicMmHg: 80, pulseBpm: 88, respiratoryRate: 18, spo2: 97, weightKg: 68.4, heightCm: 165, painScore: 2, notes: null, correctionOfId: 'vr_example_7001', correctionReason: 'Thermometer re-check after rest.' },
  { id: 'vr_example_7003', patientId: 'pat_example_1003', visitId: 'vis_example_3003', minutesAgo: 40, temperatureC: 36.8, systolicMmHg: 118, diastolicMmHg: 76, pulseBpm: 72, respiratoryRate: 16, spo2: 98, weightKg: 72, heightCm: 170, painScore: 0, notes: null, correctionOfId: null, correctionReason: null },
];
const VITAL_MEASUREMENTS = ['temperatureC', 'systolicMmHg', 'diastolicMmHg', 'pulseBpm', 'respiratoryRate', 'spo2', 'weightKg', 'heightCm', 'painScore'];
function buildVitals() {
  const now = Date.now();
  return VITAL_SEED.map((seed) => {
    const observedAt = new Date(now - seed.minutesAgo * 60000).toISOString();
    return {
      id: seed.id, patientId: seed.patientId, visitId: seed.visitId,
      temperatureC: seed.temperatureC, systolicMmHg: seed.systolicMmHg, diastolicMmHg: seed.diastolicMmHg,
      pulseBpm: seed.pulseBpm, respiratoryRate: seed.respiratoryRate, spo2: seed.spo2,
      weightKg: seed.weightKg, heightCm: seed.heightCm, painScore: seed.painScore, notes: seed.notes,
      observedAt, correctionOfId: seed.correctionOfId, correctionReason: seed.correctionReason,
      recordedByUserId: 'usr_example_0001', createdAt: observedAt,
    };
  });
}
const VITALS = buildVitals();
let vitalSeq = 7004;

// --- encounters (F4 doctor workspace) -----------------------------------
// Same contract and records as the MSW handlers, stamped against the current
// clock so "opened" reads sensibly on any day.
const ENCOUNTER_BRANCH_ID = 'br_example_0001';
const ENCOUNTER_SEED = [
  { id: 'enc_example_6001', departmentId: 'dep_example_outpatient', patientId: 'pat_example_1001', providerId: 'usr_example_9001', type: 'OUTPATIENT', status: 'OPEN', visitId: 'vis_example_3001', note: null, openedMinutesAgo: 14, inProgressMinutesAgo: null, completedMinutesAgo: null },
  { id: 'enc_example_6002', departmentId: 'dep_example_emergency', patientId: 'pat_example_1002', providerId: 'usr_example_9002', type: 'EMERGENCY', status: 'IN_PROGRESS', visitId: 'vis_example_3002', note: 'Tachycardic on arrival; monitoring in examination bay 2.', openedMinutesAgo: 96, inProgressMinutesAgo: 78, completedMinutesAgo: null },
  { id: 'enc_example_6003', departmentId: 'dep_example_paediatrics', patientId: 'pat_example_1003', providerId: 'usr_example_9003', type: 'FOLLOW_UP', status: 'COMPLETED', visitId: 'vis_example_3003', note: null, openedMinutesAgo: 220, inProgressMinutesAgo: 205, completedMinutesAgo: 170 },
  { id: 'enc_example_6004', departmentId: 'dep_example_outpatient', patientId: 'pat_example_1004', providerId: null, type: 'OUTPATIENT', status: 'OPEN', visitId: 'vis_example_3004', note: 'Reviews the previous INR result with the clinician.', openedMinutesAgo: 6, inProgressMinutesAgo: null, completedMinutesAgo: null },
];
const ENCOUNTER_TRANSITIONS = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
};
function buildEncounters() {
  return ENCOUNTER_SEED.map((seed) => {
    const openedAt = minutesAgo(seed.openedMinutesAgo);
    return {
      id: seed.id, organizationId: 'org_example_0001', branchId: ENCOUNTER_BRANCH_ID,
      departmentId: seed.departmentId, patientId: seed.patientId, providerId: seed.providerId,
      type: seed.type, status: seed.status, visitId: seed.visitId, appointmentId: null,
      note: seed.note, openedById: seed.providerId || 'usr_example_9004', openedAt,
      inProgressAt: seed.inProgressMinutesAgo === null ? null : minutesAgo(seed.inProgressMinutesAgo),
      completedAt: seed.completedMinutesAgo === null ? null : minutesAgo(seed.completedMinutesAgo),
      version: 1, createdAt: openedAt, updatedAt: minutesAgo(seed.openedMinutesAgo),
    };
  });
}
const ENCOUNTERS = buildEncounters();

// --- clinical notes (F4 doctor workspace) -------------------------------
// Same contract and records as the MSW handlers.
const NOTE_SECTION_KEYS = ['chiefComplaint', 'history', 'subjective', 'objective', 'assessment', 'plan', 'instructions', 'followUp'];
const NOTE_TEMPLATE_SEED = [
  { id: 'cnt_example_8201', name: 'EXAMPLE outpatient note', description: 'Standard outpatient consultation.', departmentId: 'dep_example_outpatient', sections: ['chiefComplaint', 'history', 'assessment', 'plan'], isActive: true },
  { id: 'cnt_example_8202', name: 'EXAMPLE emergency note', description: 'A&E resuscitation and clerking.', departmentId: 'dep_example_emergency', sections: ['history', 'objective', 'assessment', 'plan'], isActive: true },
];
const LIVE_NOTE_TEMPLATES = NOTE_TEMPLATE_SEED.map((t) => ({ ...t, organizationId: 'org_example_0001', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' }));
let noteVersionSeq = 9100;
function buildNotes() {
  const seeds = [
    { id: 'cn_example_8001', encounterId: 'enc_example_6001', patientId: 'pat_example_1001', authorId: 'usr_example_9001', status: 'FINAL', title: 'Initial assessment', sections: { chiefComplaint: 'Cough with yellow sputum for three days.', history: 'No fever reported at home; otherwise well.', assessment: 'Suspect acute bronchitis.', plan: 'Chest X-ray and symptomatic treatment.' }, reason: null, templateId: 'cnt_example_8201', createdMinutesAgo: 22, updatedMinutesAgo: 12, finalizedMinutesAgo: 12, versions: [{ versionNumber: 1, kind: 'ORIGINAL', title: 'Initial assessment', sections: { chiefComplaint: 'Cough with yellow sputum for three days.', history: 'No fever reported at home; otherwise well.', assessment: 'Suspect acute bronchitis.', plan: 'Chest X-ray and symptomatic treatment.' }, reason: null, authorId: 'usr_example_9001', minutesAgo: 12 }] },
    { id: 'cn_example_8002', encounterId: 'enc_example_6001', patientId: 'pat_example_1001', authorId: 'usr_example_9001', status: 'DRAFT', title: null, sections: { objective: 'BP 124/78, HR 88, SpO2 97% on room air.', plan: 'Oral antibiotics pending sputum culture.' }, reason: null, templateId: null, createdMinutesAgo: 8, updatedMinutesAgo: 3, finalizedMinutesAgo: null, versions: [] },
    { id: 'cn_example_8003', encounterId: 'enc_example_6002', patientId: 'pat_example_1002', authorId: 'usr_example_9002', status: 'FINAL', title: 'Resuscitation note', sections: { history: 'Chest pain radiating to the left arm, onset 45 minutes ago.', objective: 'ECG shows anterior ST elevation. Troponin raised.', assessment: 'STEMI.', plan: 'Thrombolysed; transfer to the cath lab confirmed. Aspirin and heparin given.' }, reason: 'Laboratory results returned after finalization.', templateId: 'cnt_example_8202', createdMinutesAgo: 70, updatedMinutesAgo: 40, finalizedMinutesAgo: 60, versions: [{ versionNumber: 1, kind: 'ORIGINAL', title: 'Resuscitation note', sections: { history: 'Chest pain radiating to the left arm, onset 45 minutes ago.', objective: 'ECG shows anterior ST elevation.', assessment: 'STEMI.', plan: 'Thrombolysis and transfer to the cath lab.' }, reason: null, authorId: 'usr_example_9002', minutesAgo: 60 }, { versionNumber: 2, kind: 'AMENDMENT', title: 'Resuscitation note', sections: { history: 'Chest pain radiating to the left arm, onset 45 minutes ago.', objective: 'ECG shows anterior ST elevation. Troponin raised.', assessment: 'STEMI.', plan: 'Thrombolysed; transfer to the cath lab confirmed. Aspirin and heparin given.' }, reason: 'Laboratory results returned after finalization.', authorId: 'usr_example_9002', minutesAgo: 40 }] },
  ];
  return seeds.map((seed) => ({
    id: seed.id, organizationId: 'org_example_0001', patientId: seed.patientId, encounterId: seed.encounterId,
    authorId: seed.authorId, status: seed.status, title: seed.title, sections: { ...seed.sections }, reason: seed.reason,
    templateId: seed.templateId, finalizedAt: seed.finalizedMinutesAgo === null ? null : minutesAgo(seed.finalizedMinutesAgo),
    createdAt: minutesAgo(seed.createdMinutesAgo), updatedAt: minutesAgo(seed.updatedMinutesAgo),
    _versions: seed.versions.map((v) => ({ id: `cnv_example_${noteVersionSeq++}`, versionNumber: v.versionNumber, kind: v.kind, title: v.title, sections: { ...v.sections }, reason: v.reason, authorId: v.authorId, createdAt: minutesAgo(v.minutesAgo) })),
  }));
}
const LIVE_NOTES = buildNotes();

// --- medications + prescriptions (F4 doctor workspace) --------------------
// Same contract and records as the MSW handlers.
const MEDICATION_SEED = [
  { id: 'med_example_7101', category: 'MEDICATION', name: 'EXAMPLE Amoxicillin', genericName: 'Amoxicillin', strength: '500mg', form: 'capsule', unit: 'capsule', isControlled: false },
  { id: 'med_example_7102', category: 'MEDICATION', name: 'EXAMPLE Paracetamol', genericName: 'Paracetamol', strength: '500mg', form: 'tablet', unit: 'tablet', isControlled: false },
  { id: 'med_example_7103', category: 'MEDICATION', name: 'EXAMPLE Salbutamol inhaler', genericName: 'Salbutamol', strength: '100mcg/dose', form: 'inhaler', unit: 'dose', isControlled: false },
  { id: 'med_example_7104', category: 'MEDICATION', name: 'EXAMPLE Metformin', genericName: 'Metformin', strength: '500mg', form: 'tablet', unit: 'tablet', isControlled: false },
  { id: 'med_example_7105', category: 'MEDICATION', name: 'EXAMPLE Morphine (controlled)', genericName: 'Morphine', strength: '10mg/mL', form: 'ampoule', unit: 'ampoule', isControlled: true },
  { id: 'med_example_7106', category: 'SUPPLY', name: 'EXAMPLE Gauze roll', genericName: null, strength: null, form: 'roll', unit: 'roll', isControlled: false },
];
const LIVE_MEDICATIONS = MEDICATION_SEED.map((m) => ({ ...m, organizationId: 'org_example_0001', sku: null, barcode: null, isActive: true, version: 1, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' }));
let prxItemSeq = 7100;
function buildPrescriptions() {
  const seeds = [
    { id: 'prx_example_7001', patientId: 'pat_example_1001', providerId: 'usr_example_9001', status: 'DRAFT', notes: null, createdMinutesAgo: 9, issuedMinutesAgo: null, dispensedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, items: [{ medicationId: 'med_example_7101', quantity: 21, dispensedQuantity: 0, dosage: '500mg', frequency: '8 hourly', durationDays: 7, instructions: 'Take after food.' }] },
    { id: 'prx_example_7002', patientId: 'pat_example_1001', providerId: 'usr_example_9001', status: 'ISSUED', notes: 'For headache not controlled by rest.', createdMinutesAgo: 40, issuedMinutesAgo: 33, dispensedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, items: [{ medicationId: 'med_example_7102', quantity: 12, dispensedQuantity: 0, dosage: '1g', frequency: 'when required, max 4 times daily', durationDays: null, instructions: 'Do not exceed four doses a day.' }] },
    { id: 'prx_example_7003', patientId: 'pat_example_1002', providerId: 'usr_example_9002', status: 'DISPENSED', notes: null, createdMinutesAgo: 65, issuedMinutesAgo: 62, dispensedMinutesAgo: 50, cancelledMinutesAgo: null, cancelReason: null, items: [{ medicationId: 'med_example_7103', quantity: 200, dispensedQuantity: 200, dosage: '200mcg (2 puffs)', frequency: 'when required', durationDays: 30, instructions: 'Use spacer in the emergency bay.' }] },
    { id: 'prx_example_7004', patientId: 'pat_example_1003', providerId: 'usr_example_9003', status: 'CANCELLED', notes: null, createdMinutesAgo: 210, issuedMinutesAgo: null, dispensedMinutesAgo: null, cancelledMinutesAgo: 195, cancelReason: 'EXAMPLE changed the plan to amoxicillin–clavulanate.', items: [{ medicationId: 'med_example_7101', quantity: 10, dispensedQuantity: 0, dosage: '250mg', frequency: '12 hourly', durationDays: 5, instructions: null }] },
    { id: 'prx_example_7005', patientId: 'pat_example_1002', providerId: 'usr_example_9002', status: 'ISSUED', notes: 'Start metformin alongside lifestyle advice.', createdMinutesAgo: 26, issuedMinutesAgo: 21, dispensedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, items: [{ medicationId: 'med_example_7104', quantity: 28, dispensedQuantity: 0, dosage: '500mg', frequency: 'twice daily with meals', durationDays: 28, instructions: 'Swallow whole; do not crush.' }] },
    { id: 'prx_example_7006', patientId: 'pat_example_1004', providerId: 'usr_example_9002', status: 'PARTIALLY_DISPENSED', notes: 'Half the course supplied; balance to follow.', createdMinutesAgo: 52, issuedMinutesAgo: 47, dispensedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, items: [{ medicationId: 'med_example_7101', quantity: 21, dispensedQuantity: 10, dosage: '500mg', frequency: '8 hourly', durationDays: 7, instructions: 'Complete the full course.' }] },
  ];
  return seeds.map((seed) => ({
    id: seed.id, organizationId: 'org_example_0001', branchId: 'br_example_0001',
    patientId: seed.patientId, providerId: seed.providerId, status: seed.status, notes: seed.notes,
    issuedById: seed.issuedMinutesAgo === null ? null : seed.providerId,
    issuedAt: seed.issuedMinutesAgo === null ? null : minutesAgo(seed.issuedMinutesAgo),
    dispensedAt: seed.dispensedMinutesAgo === null ? null : minutesAgo(seed.dispensedMinutesAgo),
    cancelledById: seed.cancelledMinutesAgo === null ? null : 'usr_example_9004',
    cancelledAt: seed.cancelledMinutesAgo === null ? null : minutesAgo(seed.cancelledMinutesAgo),
    cancelReason: seed.cancelReason, version: 1, createdAt: minutesAgo(seed.createdMinutesAgo),
    _items: seed.items.map((item) => ({ id: `pri_example_${prxItemSeq++}`, medicationId: item.medicationId, quantity: item.quantity, dispensedQuantity: item.dispensedQuantity, dosage: item.dosage, frequency: item.frequency, durationDays: item.durationDays, instructions: item.instructions })),
  }));
}
const LIVE_PRESCRIPTIONS = buildPrescriptions();
// --- pharmacy inventory (F6 dispense worklist) ---------------------------
// Same contract and records as the MSW handlers. Branch stock is mutable so the
// dispense write is reflected by the next on-hand read.
const INVENTORY_BRANCH_ID = 'br_example_0001';
const STOCK_ON_HAND_SEED = [
  { medicationId: 'med_example_7101', quantity: 30 },
  { medicationId: 'med_example_7102', quantity: 40 },
  { medicationId: 'med_example_7103', quantity: 12, expiryInDays: 18 },
  { medicationId: 'med_example_7104', quantity: 60 },
  { medicationId: 'med_example_7105', quantity: 4 },
  { medicationId: 'med_example_7106', quantity: 8 },
];
const LIVE_STOCK = new Map(STOCK_ON_HAND_SEED.map((row) => [row.medicationId, row.quantity]));
const LIVE_EXPIRY_DAYS = new Map(
  STOCK_ON_HAND_SEED.filter((row) => row.expiryInDays !== undefined).map((row) => [row.medicationId, row.expiryInDays]),
);
const INVENTORY_BATCH_IDS = new Map();
let inventoryBatchSeq = 7300;
let inventoryWriteOffSeq = 7300;
const LOW_STOCK_AT_OR_BELOW = 5;
const REORDER_AT_OR_BELOW = 15;
function inventoryMedicationName(medicationId) {
  const medication = LIVE_MEDICATIONS.find((m) => m.id === medicationId);
  return medication ? medication.name : medicationId;
}
function serializeInventoryAlerts() {
  const alerts = [];
  for (const [medicationId, quantity] of LIVE_STOCK) {
    const name = inventoryMedicationName(medicationId);
    const expiry = LIVE_EXPIRY_DAYS.get(medicationId);
    if (expiry !== undefined && expiry <= 30) {
      alerts.push({ medicationId, name, label: 'EXPIRY_RISK', detail: `Closest expiry in ${expiry} day(s).` });
    }
    if (quantity <= LOW_STOCK_AT_OR_BELOW) {
      alerts.push({ medicationId, name, label: 'LOW_STOCK', detail: 'Stock at or below target cover with no usage history.' });
    } else if (quantity <= REORDER_AT_OR_BELOW) {
      alerts.push({ medicationId, name, label: 'REORDER_RISK', detail: `${(quantity / 2).toFixed(1)} day(s) of cover — order soon.` });
    }
  }
  return alerts;
}
function inventoryBatchIdFor(branchId, medicationId, batchNumber) {
  const key = `${branchId}:${medicationId}:${batchNumber}`;
  if (INVENTORY_BATCH_IDS.has(key)) return INVENTORY_BATCH_IDS.get(key);
  const id = `bat_example_${inventoryBatchSeq++}`;
  INVENTORY_BATCH_IDS.set(key, id);
  return id;
}

// --- billing (F7 invoices desk) ------------------------------------------
// Same contract and records as the MSW handlers. Money is handled in integer
// cents so a mock balance cannot drift; invoices are mutable so an issue,
// payment, cancel or refund lands on the next read.
const BILLING_BRANCH_ID = 'br_example_0001';
function billingItem(id, description, unitPrice, referenceType = null, referenceId = null) {
  return { id, organizationId: 'org_example_0001', invoiceId: null, billableItemId: null, medicationId: null, description, quantity: 1, unitPrice, lineTotal: unitPrice, referenceType, referenceId, createdById: null, createdAt: '2026-10-01T08:00:00.000Z' };
}
function billingPayment(id, receiptNumber, amount, method, status, recordedAt, { refundedAt = null, refundReason = null, externalReference = null, note = null } = {}) {
  return { id, organizationId: 'org_example_0001', invoiceId: null, patientId: null, receiptNumber, amount, method, status, externalReference, note, recordedById: 'usr_example_9001', recordedAt, refundedById: null, refundedAt, refundReason, createdAt: recordedAt, updatedAt: recordedAt };
}
function billingInvoice({ id, patientId, invoiceNumber, status, total, balanceDue, issuedAt = null, dueAt = null, cancelledAt = null, cancelReason = null, refundedAt = null, refundReason = null, version = 1, items = [], payments = [] }) {
  const stamp = issuedAt ?? '2026-10-01T08:00:00.000Z';
  return { id, organizationId: 'org_example_0001', branchId: BILLING_BRANCH_ID, patientId, invoiceNumber, status, visitId: null, encounterId: null, subtotal: total, discountAmount: '0.00', taxAmount: '0.00', total, balanceDue, dueAt, notes: null, issuedById: null, issuedAt, cancelledById: null, cancelledAt, cancelReason, refundedById: null, refundedAt, refundReason, version, createdAt: stamp, updatedAt: stamp, items, payments };
}
const LIVE_INVOICES = [
  billingInvoice({
    id: 'inv_example_8001', patientId: 'pat_example_1001', invoiceNumber: 'INV-2026-000001', status: 'ISSUED', total: '1500.00', balanceDue: '1500.00', issuedAt: '2026-10-01T09:00:00.000Z', dueAt: '2026-10-20T00:00:00.000Z', version: 2,
    items: [billingItem('item_example_80011', 'Consultation — general', '1500.00', 'ENCOUNTER', 'enc_example_1')],
  }),
  billingInvoice({
    id: 'inv_example_8002', patientId: 'pat_example_1002', invoiceNumber: 'INV-2026-000002', status: 'PARTIALLY_PAID', total: '4200.00', balanceDue: '2200.00', issuedAt: '2026-10-02T11:30:00.000Z', dueAt: '2026-10-25T00:00:00.000Z', version: 3,
    items: [billingItem('item_example_80021', 'Consultation — specialist', '1500.00', 'ENCOUNTER', 'enc_example_2'), billingItem('item_example_80022', 'Laboratory — full blood count', '2700.00', 'LAB_ORDER', 'lab_example_5001')],
    payments: [billingPayment('pay_example_9001', 'RCP-2026-000101', '2000.00', 'MOBILE_MONEY', 'COMPLETED', '2026-10-02T12:05:00.000Z', { externalReference: 'MPESA-XY12' })],
  }),
  billingInvoice({
    id: 'inv_example_8003', patientId: 'pat_example_1003', invoiceNumber: 'INV-2026-000003', status: 'PAID', total: '800.00', balanceDue: '0.00', issuedAt: '2026-10-03T08:15:00.000Z',
    items: [billingItem('item_example_80031', 'Pharmacy — dispensed medication', '800.00', 'PRESCRIPTION', 'rx_example_4001')],
    payments: [billingPayment('pay_example_9002', 'RCP-2026-000102', '800.00', 'CASH', 'COMPLETED', '2026-10-03T08:20:00.000Z', { note: 'Paid at the front desk.' })],
  }),
  billingInvoice({
    id: 'inv_example_8004', patientId: 'pat_example_1004', invoiceNumber: 'INV-2026-000004', status: 'DRAFT', total: '3500.00', balanceDue: '3500.00',
    items: [billingItem('item_example_80041', 'Procedure — wound dressing', '3500.00', 'PROCEDURE', null)],
  }),
  billingInvoice({
    id: 'inv_example_8005', patientId: 'pat_example_1001', invoiceNumber: 'INV-2026-000005', status: 'CANCELLED', total: '1200.00', balanceDue: '0.00', issuedAt: '2026-10-04T10:00:00.000Z', cancelledAt: '2026-10-04T10:30:00.000Z', cancelReason: 'EXAMPLE duplicate of INV-2026-000001.', version: 2,
    items: [billingItem('item_example_80051', 'Radiology — chest X-ray', '1200.00', 'RADIOLOGY_ORDER', null)],
  }),
  billingInvoice({
    id: 'inv_example_8006', patientId: 'pat_example_1002', invoiceNumber: 'INV-2026-000006', status: 'REFUNDED', total: '900.00', balanceDue: '900.00', issuedAt: '2026-10-05T13:00:00.000Z', refundedAt: '2026-10-06T09:45:00.000Z', refundReason: 'EXAMPLE test cancelled after payment.', version: 3,
    items: [billingItem('item_example_80061', 'Laboratory — malaria screen', '900.00', 'LAB_ORDER', 'lab_example_5002')],
    payments: [billingPayment('pay_example_9003', 'RCP-2026-000103', '900.00', 'CARD', 'REFUNDED', '2026-10-05T13:10:00.000Z', { refundedAt: '2026-10-06T09:45:00.000Z', refundReason: 'EXAMPLE test cancelled after payment.' })],
  }),
].map((invoice) => ({
  ...invoice,
  items: invoice.items.map((item) => ({ ...item, invoiceId: invoice.id })),
  payments: invoice.payments.map((payment) => ({ ...payment, invoiceId: invoice.id, patientId: invoice.patientId })),
}));
let billingReceiptSeq = 104;
let billingPaymentSeq = 9004;
function billingCents(value) {
  const negative = value.startsWith('-');
  const [whole, frac = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}
function billingFromCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}
function billingFind(id) {
  return LIVE_INVOICES.find((invoice) => invoice.id === id);
}
function billingListRow(invoice) {
  return { ...invoice, payments: [] };
}

// --- insurance (F7 claims desk) ------------------------------------------
// Same contract and records as the MSW handlers. Claim money stays a decimal
// string; claims are mutable so a submit/decide/pay lands on the next read.
const INSURANCE_ORG = 'org_example_0001';
function insurancePayer(id, name, contactPhone, email) {
  return { id, organizationId: INSURANCE_ORG, name, contactPhone, email, isActive: true, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' };
}
function insurancePolicy(id, patientId, payerId, policyNumber, coverageType, coveragePercent, validityEnd = '2026-12-31T00:00:00.000Z') {
  return { id, organizationId: INSURANCE_ORG, patientId, payerId, policyNumber, coverageType, coveragePercent, validityStart: '2026-01-01T00:00:00.000Z', validityEnd, isActive: true, version: 1, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' };
}
function insuranceClaim({ id, claimNumber, invoiceId, policyId, patientId, amount, status, notes = null, submittedAt = null, approvedAt = null, approvedAmount = null, deniedAt = null, denyReason = null, paidAt = null, version = 1 }) {
  return { id, organizationId: INSURANCE_ORG, claimNumber, invoiceId, policyId, patientId, amount, status, notes, submittedAt, approvedAt, approvedAmount, deniedAt, denyReason, paidAt, version, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: paidAt ?? deniedAt ?? approvedAt ?? submittedAt ?? '2026-10-01T08:00:00.000Z' };
}
const LIVE_PAYERS = [
  insurancePayer('payer_example_6001', 'EXAMPLE Jubilee Health', '+254700000010', 'claims@example.org'),
  insurancePayer('payer_example_6002', 'EXAMPLE AAR Insurance', '+254700000011', 'health@example.org'),
];
const LIVE_POLICIES = [
  insurancePolicy('pol_example_7001', 'pat_example_1001', 'payer_example_6001', 'POL-2026-000001', 'PARTIAL', 80),
  insurancePolicy('pol_example_7002', 'pat_example_1002', 'payer_example_6002', 'POL-2026-000002', 'FULL', 100),
  insurancePolicy('pol_example_7003', 'pat_example_1003', 'payer_example_6001', 'POL-2026-000003', 'PARTIAL', 50, null),
];
const LIVE_CLAIMS = [
  insuranceClaim({ id: 'claim_example_5001', claimNumber: 'CLM-2026-000001', invoiceId: 'inv_example_8001', policyId: 'pol_example_7001', patientId: 'pat_example_1001', amount: '1500.00', status: 'DRAFT', notes: 'EXAMPLE claim awaiting submission.' }),
  insuranceClaim({ id: 'claim_example_5002', claimNumber: 'CLM-2026-000002', invoiceId: 'inv_example_8002', policyId: 'pol_example_7002', patientId: 'pat_example_1002', amount: '4200.00', status: 'SUBMITTED', submittedAt: '2026-10-03T09:30:00.000Z', version: 2 }),
  insuranceClaim({ id: 'claim_example_5003', claimNumber: 'CLM-2026-000003', invoiceId: 'inv_example_8003', policyId: 'pol_example_7003', patientId: 'pat_example_1003', amount: '800.00', status: 'PAID', submittedAt: '2026-10-03T10:00:00.000Z', approvedAt: '2026-10-04T11:00:00.000Z', approvedAmount: '800.00', paidAt: '2026-10-05T12:00:00.000Z', version: 4 }),
  insuranceClaim({ id: 'claim_example_5004', claimNumber: 'CLM-2026-000004', invoiceId: 'inv_example_8001', policyId: 'pol_example_7001', patientId: 'pat_example_1001', amount: '1500.00', status: 'PARTIALLY_APPROVED', submittedAt: '2026-10-05T09:00:00.000Z', approvedAt: '2026-10-06T09:00:00.000Z', approvedAmount: '1000.00', version: 3 }),
  insuranceClaim({ id: 'claim_example_5005', claimNumber: 'CLM-2026-000005', invoiceId: 'inv_example_8002', policyId: 'pol_example_7002', patientId: 'pat_example_1002', amount: '4200.00', status: 'DENIED', submittedAt: '2026-10-05T10:00:00.000Z', deniedAt: '2026-10-06T10:00:00.000Z', denyReason: 'EXAMPLE pre-existing condition not covered by the policy.', version: 3 }),
  insuranceClaim({ id: 'claim_example_5006', claimNumber: 'CLM-2026-000006', invoiceId: 'inv_example_8002', policyId: 'pol_example_7002', patientId: 'pat_example_1002', amount: '4200.00', status: 'APPROVED', submittedAt: '2026-10-06T11:00:00.000Z', approvedAt: '2026-10-07T11:00:00.000Z', approvedAmount: '4200.00', version: 3 }),
];
let claimSeq = 7;
let payerSeq = 3;
let policySeq = 4;
function insuranceFindClaim(id) {
  return LIVE_CLAIMS.find((claim) => claim.id === id);
}

// --- inpatient (F8 ward board) ------------------------------------------
// Wards carry their rooms and beds nested; beds are mutable so a status change
// lands on the next board read.
const INPATIENT_ORG = 'org_example_0001';
const INPATIENT_BRANCH_ID = 'br_example_0001';
const INPATIENT_STAMP = '2026-10-01T08:00:00.000Z';
function inpatientBed(id, roomId, bedNumber, status, version = 1) {
  return { id, organizationId: INPATIENT_ORG, roomId, bedNumber, status, version, createdAt: INPATIENT_STAMP, updatedAt: INPATIENT_STAMP };
}
function inpatientRoom(id, wardId, name, description, beds) {
  return { id, organizationId: INPATIENT_ORG, wardId, name, description, createdAt: INPATIENT_STAMP, updatedAt: INPATIENT_STAMP, beds };
}
function inpatientWard({ id, name, code, floor, description, isActive = true, rooms }) {
  return { id, organizationId: INPATIENT_ORG, branchId: INPATIENT_BRANCH_ID, name, code, floor, description, isActive, createdAt: INPATIENT_STAMP, updatedAt: INPATIENT_STAMP, rooms };
}
const LIVE_WARDS = [
  inpatientWard({ id: 'ward_example_3001', name: 'EXAMPLE Medical Ward', code: 'MED', floor: '1st Floor', description: 'EXAMPLE general medical ward.', rooms: [
    inpatientRoom('room_example_3101', 'ward_example_3001', 'Room 101', null, [
      inpatientBed('bed_example_4101', 'room_example_3101', '101-A', 'OCCUPIED', 3),
      inpatientBed('bed_example_4102', 'room_example_3101', '101-B', 'AVAILABLE'),
      inpatientBed('bed_example_4103', 'room_example_3101', '101-C', 'CLEANING', 2),
    ]),
    inpatientRoom('room_example_3102', 'ward_example_3001', 'Room 102', 'EXAMPLE side room.', [
      inpatientBed('bed_example_4104', 'room_example_3102', '102-A', 'RESERVED'),
      inpatientBed('bed_example_4105', 'room_example_3102', '102-B', 'AVAILABLE'),
    ]),
  ]}),
  inpatientWard({ id: 'ward_example_3002', name: 'EXAMPLE Surgical Ward', code: 'SURG', floor: '2nd Floor', description: 'EXAMPLE post-operative ward.', rooms: [
    inpatientRoom('room_example_3201', 'ward_example_3002', 'Room 201', null, [
      inpatientBed('bed_example_4201', 'room_example_3201', '201-A', 'OCCUPIED', 4),
      inpatientBed('bed_example_4202', 'room_example_3201', '201-B', 'MAINTENANCE', 2),
    ]),
    inpatientRoom('room_example_3202', 'ward_example_3002', 'Room 202', null, [
      inpatientBed('bed_example_4203', 'room_example_3202', '202-A', 'AVAILABLE'),
      inpatientBed('bed_example_4204', 'room_example_3202', '202-B', 'BLOCKED'),
    ]),
  ]}),
  inpatientWard({ id: 'ward_example_3003', name: 'EXAMPLE Maternity Ward', code: 'MAT', floor: '1st Floor', description: 'EXAMPLE maternity and newborn ward.', isActive: false, rooms: [
    inpatientRoom('room_example_3301', 'ward_example_3003', 'Room 301', null, [
      inpatientBed('bed_example_4301', 'room_example_3301', '301-A', 'AVAILABLE'),
      inpatientBed('bed_example_4302', 'room_example_3301', '301-B', 'AVAILABLE'),
    ]),
  ]}),
];
let wardSeq = 3004;
let roomSeq = 3302;
let bedSeq = 4303;
const MANUAL_BED_STATUSES = ['AVAILABLE', 'RESERVED', 'CLEANING', 'MAINTENANCE', 'BLOCKED'];
function findWard(id) { return LIVE_WARDS.find((ward) => ward.id === id); }
function findRoom(id) {
  for (const ward of LIVE_WARDS) {
    const room = ward.rooms.find((row) => row.id === id);
    if (room) return { ward, room };
  }
  return null;
}
function findBed(id) {
  for (const ward of LIVE_WARDS) {
    for (const room of ward.rooms) {
      const bed = room.beds.find((row) => row.id === id);
      if (bed) return { ward, room, bed };
    }
  }
  return null;
}

// Admissions seeded against the beds above: two ADMITTED holding the two
// occupied beds and one DISCHARGED with a released assignment and a discharge.
function stubAssignment(id, bedId, admissionId, assignedAt, releasedAt = null) {
  return { id, bedId, admissionId, assignedById: 'usr_example_0001', assignedAt, releasedById: releasedAt ? 'usr_example_0001' : null, releasedAt, reason: null };
}
const LIVE_ADMISSIONS = [
  { id: 'adm_example_9001', admissionNumber: 'ADM-2026-000001', patientId: 'pat_example_1001', branchId: INPATIENT_BRANCH_ID, departmentId: null, encounterId: null, source: 'OUTPATIENT_CLINIC', status: 'ADMITTED', admittedById: 'usr_example_0001', admittedAt: '2026-10-05T09:15:00.000Z', expectedDischargeAt: '2026-10-12T09:00:00.000Z', provisionalDiagnosis: 'EXAMPLE community-acquired pneumonia.', version: 1, assignments: [stubAssignment('asg_example_9501', 'bed_example_4101', 'adm_example_9001', '2026-10-05T09:15:00.000Z')], discharge: null },
  { id: 'adm_example_9002', admissionNumber: 'ADM-2026-000002', patientId: 'pat_example_1002', branchId: INPATIENT_BRANCH_ID, departmentId: null, encounterId: null, source: 'EMERGENCY', status: 'ADMITTED', admittedById: 'usr_example_0001', admittedAt: '2026-10-07T22:40:00.000Z', expectedDischargeAt: null, provisionalDiagnosis: 'EXAMPLE fractured right tibia, post-operative.', version: 1, assignments: [stubAssignment('asg_example_9502', 'bed_example_4201', 'adm_example_9002', '2026-10-07T22:40:00.000Z')], discharge: null },
  { id: 'adm_example_9003', admissionNumber: 'ADM-2026-000003', patientId: 'pat_example_1003', branchId: INPATIENT_BRANCH_ID, departmentId: null, encounterId: null, source: 'REFERRAL', status: 'DISCHARGED', admittedById: 'usr_example_0001', admittedAt: '2026-09-20T10:00:00.000Z', expectedDischargeAt: null, provisionalDiagnosis: 'EXAMPLE diabetic foot ulcer.', version: 2, assignments: [stubAssignment('asg_example_9503', 'bed_example_4102', 'adm_example_9003', '2026-09-20T10:00:00.000Z', '2026-09-27T11:30:00.000Z')], discharge: { id: 'dsc_example_9601', admissionId: 'adm_example_9003', dischargedById: 'usr_example_0001', dischargedAt: '2026-09-27T11:30:00.000Z', summary: 'EXAMPLE wound healed; discharged on oral antibiotics.', instructions: 'EXAMPLE keep the dressing dry; review in clinic.', followUp: { type: 'EXAMPLE Outpatient review', date: '2026-10-04T09:00:00.000Z', notes: null }, hasOutstandingBilling: false } },
];
let admissionSeq = 9004;
let assignmentSeq = 9504;
let dischargeSeq = 9602;
function findAdmission(id) { return LIVE_ADMISSIONS.find((admission) => admission.id === id); }
function activeAssignment(admission) { return admission.assignments.find((row) => row.releasedAt === null); }
function bedAssignable(bedId) {
  const found = findBed(bedId);
  if (!found || found.bed.status !== 'AVAILABLE') return false;
  return !LIVE_ADMISSIONS.some((admission) => admission.status === 'ADMITTED' && admission.assignments.some((row) => row.bedId === bedId && row.releasedAt === null));
}

// Emergency visits seeded across the whole workflow, mirroring
// src/mocks/fixtures/emergency-registry.ts. Admitting from the ED creates an
// admission against the same LIVE_ADMISSIONS and LIVE_WARDS state above.
function stubEmergencyVisit(id, visitNumber, patientId, overrides = {}) {
  return {
    id, organizationId: 'org_example_1', visitNumber, branchId: INPATIENT_BRANCH_ID, patientId,
    status: 'ARRIVED', priority: null, registeredById: 'usr_example_0001', arrivedById: 'usr_example_0001',
    arrivedAt: '2026-10-10T06:30:00.000Z', chiefComplaint: null, triagedById: null, triagedAt: null,
    assessedAt: null, assessment: null, treatmentStartedAt: null, treatment: null, observedAt: null,
    dispositionAt: null, disposition: null, admittedAdmissionId: null, referredTo: null, referralNotes: null,
    version: 2, createdAt: '2026-10-10T06:30:00.000Z', updatedAt: '2026-10-10T06:30:00.000Z', ...overrides,
  };
}
const LIVE_EMERGENCY_VISITS = [
  stubEmergencyVisit('erv_example_7001', 'ER-2026-000001', 'pat_example_1001', { status: 'ARRIVED', arrivedAt: '2026-10-10T06:05:00.000Z', version: 1, createdAt: '2026-10-10T06:05:00.000Z', updatedAt: '2026-10-10T06:05:00.000Z' }),
  stubEmergencyVisit('erv_example_7002', 'ER-2026-000002', 'pat_example_1002', { status: 'TRIAGED', priority: 'URGENT', arrivedAt: '2026-10-10T06:40:00.000Z', chiefComplaint: 'EXAMPLE severe abdominal pain and vomiting.', triagedById: 'usr_example_0001', triagedAt: '2026-10-10T06:52:00.000Z', updatedAt: '2026-10-10T06:52:00.000Z' }),
  stubEmergencyVisit('erv_example_7003', 'ER-2026-000003', 'pat_example_1003', { status: 'ASSESSED', priority: 'EMERGENT', arrivedAt: '2026-10-10T07:10:00.000Z', chiefComplaint: 'EXAMPLE shortness of breath at rest.', triagedById: 'usr_example_0001', triagedAt: '2026-10-10T07:15:00.000Z', assessedAt: '2026-10-10T07:35:00.000Z', assessment: 'EXAMPLE hypoxia; suspected pneumonia, oxygen started.', version: 4, updatedAt: '2026-10-10T07:35:00.000Z' }),
  stubEmergencyVisit('erv_example_7004', 'ER-2026-000004', 'pat_example_1004', { status: 'IN_TREATMENT', priority: 'URGENT', arrivedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: 'EXAMPLE deep laceration to the left forearm.', triagedById: 'usr_example_0001', triagedAt: '2026-10-10T08:08:00.000Z', assessedAt: '2026-10-10T08:20:00.000Z', assessment: 'EXAMPLE no tendon involvement; needs irrigation and sutures.', treatmentStartedAt: '2026-10-10T08:30:00.000Z', treatment: 'EXAMPLE local anaesthetic, wound irrigation and suturing.', version: 5, updatedAt: '2026-10-10T08:30:00.000Z' }),
  stubEmergencyVisit('erv_example_7005', 'ER-2026-000005', 'pat_example_1001', { status: 'OBSERVATION', priority: 'SEMI_URGENT', arrivedAt: '2026-10-10T09:15:00.000Z', chiefComplaint: 'EXAMPLE dizziness on standing.', triagedById: 'usr_example_0001', triagedAt: '2026-10-10T09:22:00.000Z', assessedAt: '2026-10-10T09:40:00.000Z', assessment: 'EXAMPLE postural drop; observing after fluids.', treatmentStartedAt: '2026-10-10T09:50:00.000Z', treatment: 'EXAMPLE intravenous fluids given.', observedAt: '2026-10-10T10:30:00.000Z', version: 6, updatedAt: '2026-10-10T10:30:00.000Z' }),
  stubEmergencyVisit('erv_example_7006', 'ER-2026-000006', 'pat_example_1002', { status: 'DISCHARGED', priority: 'NON_URGENT', arrivedAt: '2026-10-10T10:00:00.000Z', chiefComplaint: 'EXAMPLE minor ankle sprain.', triagedById: 'usr_example_0001', triagedAt: '2026-10-10T10:05:00.000Z', assessedAt: '2026-10-10T10:20:00.000Z', assessment: 'EXAMPLE stable sprain, no fracture on X-ray.', treatmentStartedAt: '2026-10-10T10:30:00.000Z', treatment: 'EXAMPLE supportive bandage and analgesia.', dispositionAt: '2026-10-10T11:00:00.000Z', disposition: 'DISCHARGED', version: 7, updatedAt: '2026-10-10T11:00:00.000Z' }),
  stubEmergencyVisit('erv_example_7007', 'ER-2026-000007', 'pat_example_1002', { status: 'ADMITTED', priority: 'EMERGENT', arrivedAt: '2026-10-10T11:10:00.000Z', chiefComplaint: 'EXAMPLE displaced ankle fracture.', triagedById: 'usr_example_0001', triagedAt: '2026-10-10T11:15:00.000Z', assessedAt: '2026-10-10T11:30:00.000Z', assessment: 'EXAMPLE fracture requiring surgery; admitted orthopaedics.', treatmentStartedAt: '2026-10-10T11:40:00.000Z', treatment: 'EXAMPLE splinted and analgesia.', dispositionAt: '2026-10-10T12:20:00.000Z', disposition: 'ADMITTED', admittedAdmissionId: 'adm_example_9002', version: 8, updatedAt: '2026-10-10T12:20:00.000Z' }),
  stubEmergencyVisit('erv_example_7008', 'ER-2026-000008', 'pat_example_1004', { status: 'REFERRED', priority: 'URGENT', arrivedAt: '2026-10-10T12:00:00.000Z', chiefComplaint: 'EXAMPLE suspected transient ischaemic attack.', triagedById: 'usr_example_0001', triagedAt: '2026-10-10T12:05:00.000Z', assessedAt: '2026-10-10T12:25:00.000Z', assessment: 'EXAMPLE neurology review required urgently.', dispositionAt: '2026-10-10T12:50:00.000Z', disposition: 'REFERRED', referredTo: 'EXAMPLE Regional Neurology Unit', referralNotes: 'EXAMPLE referred for immediate specialist assessment.', version: 6, updatedAt: '2026-10-10T12:50:00.000Z' }),
];
let emergencyVisitSeq = 7009;
const EMERGENCY_TERMINAL = ['DISCHARGED', 'ADMITTED', 'REFERRED'];
const EMERGENCY_SOURCES = {
  triage: ['ARRIVED'], assess: ['TRIAGED'], treat: ['ASSESSED'], observe: ['ASSESSED', 'IN_TREATMENT'],
  admit: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'], refer: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
  discharge: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
};
const EMERGENCY_PRIORITIES = ['RESUSCITATION', 'EMERGENT', 'URGENT', 'SEMI_URGENT', 'NON_URGENT'];
function findEmergencyVisit(id) { return LIVE_EMERGENCY_VISITS.find((visit) => visit.id === id); }
function stubCreateAdmission(patientId, bedId, source, departmentId, provisionalDiagnosis, expectedDischargeAt) {
  const now = new Date().toISOString();
  const id = `adm_example_${admissionSeq++}`;
  const admission = { id, admissionNumber: `ADM-${now.slice(0, 4)}-${String(admissionSeq - 1).padStart(6, '0')}`, patientId, branchId: INPATIENT_BRANCH_ID, departmentId, encounterId: null, source, status: 'ADMITTED', admittedById: 'usr_example_0001', admittedAt: now, expectedDischargeAt, provisionalDiagnosis, version: 1, assignments: [{ id: `asg_example_${assignmentSeq++}`, bedId, admissionId: id, assignedById: 'usr_example_0001', assignedAt: now, releasedById: null, releasedAt: null, reason: null }], discharge: null };
  LIVE_ADMISSIONS.push(admission);
  const found = findBed(bedId);
  if (found) { found.bed.status = 'OCCUPIED'; found.bed.version += 1; found.bed.updatedAt = now; }
  return admission;
}


// F9 administration fixtures, mirroring src/mocks/fixtures/admin-registry.ts.
// The roster walks every user status so each tone and action is reachable, and
// the permission catalog is the body GET /roles/permissions answers.
function adminRole(id, key, name, isSystem, permissions, description = null) {
  return { id, key, name, description, isSystem, permissions, createdAt: '2026-01-02T08:00:00.000Z' };
}
const LIVE_ADMIN_ROLES = [
  adminRole('rol_example_0001', 'SUPER_ADMIN', 'Super administrator', true, ['organizations.read', 'organizations.manage', 'users.read', 'users.manage', 'roles.read', 'roles.manage', 'sessions.manage', 'staff.read', 'staff.manage']),
  adminRole('rol_example_0002', 'OWNER', 'Owner', true, ['organizations.read', 'users.read', 'users.manage', 'roles.read', 'roles.manage', 'reports.read']),
  adminRole('rol_example_0003', 'HOSPITAL_ADMIN', 'Hospital administrator', true, ['users.read', 'users.manage', 'roles.read', 'staff.read', 'staff.manage', 'reports.read']),
  adminRole('rol_example_0004', 'DOCTOR', 'Doctor', false, ['patients.read', 'encounters.read', 'encounters.create', 'clinical_notes.read', 'clinical_notes.create', 'prescriptions.read', 'prescription.create', 'lab.read', 'radiology.read'], 'EXAMPLE clinical role.'),
  adminRole('rol_example_0005', 'NURSE', 'Nurse', false, ['patients.read', 'vitals.read', 'vitals.record', 'queue.read', 'beds.read'], 'EXAMPLE nursing role.'),
  adminRole('rol_example_0006', 'RECEPTIONIST', 'Receptionist', false, ['patients.read', 'patients.create', 'appointments.read', 'appointments.create', 'queue.read', 'queue.create'], 'EXAMPLE front-desk role.'),
  adminRole('rol_example_0007', 'PHARMACIST', 'Pharmacist', false, ['prescription.read', 'pharmacy.dispense', 'pharmacy.inventory'], 'EXAMPLE pharmacy role.'),
  adminRole('rol_example_0008', 'ACCOUNTANT', 'Accountant', false, ['billing.read', 'billing.manage', 'insurance.read'], 'EXAMPLE finance role.'),
  adminRole('rol_example_0009', 'LAB_TECHNICIAN', 'Laboratory technician', false, ['lab.read', 'lab.process', 'lab.verify', 'lab.release'], 'EXAMPLE laboratory role.'),
];
function adminRoleRef(key) {
  const found = LIVE_ADMIN_ROLES.find((entry) => entry.key === key);
  return { id: found.id, key: found.key, name: found.name };
}
function adminStaff(id, staffNumber, professionalTitle, specialization, employmentStatus) {
  return { id, staffNumber, professionalTitle, specialization, employmentStatus };
}
const LIVE_ADMIN_USERS = [
  { id: 'usr_example_0001', email: 'nurse@example.org', firstName: 'EXAMPLE', lastName: 'Nurse', otherNames: null, phone: null, status: 'ACTIVE', createdAt: '2026-01-02T08:00:00.000Z', roles: [adminRoleRef('NURSE')], staff: null },
  { id: 'usr_example_0002', email: 'amina.example@careos.example', firstName: 'Amina', lastName: 'Odhiambo', otherNames: null, phone: '+254700000002', status: 'ACTIVE', createdAt: '2026-02-10T09:15:00.000Z', roles: [adminRoleRef('DOCTOR')], staff: adminStaff('stf_example_0002', 'STF-0002', 'Consultant Physician', 'Internal Medicine', 'ACTIVE') },
  { id: 'usr_example_0003', email: 'brian.example@careos.example', firstName: 'Brian', lastName: 'Kimani', otherNames: null, phone: '+254700000003', status: 'ACTIVE', createdAt: '2026-03-04T11:00:00.000Z', roles: [adminRoleRef('RECEPTIONIST')], staff: adminStaff('stf_example_0003', 'STF-0003', 'Reception Supervisor', 'Front Office', 'ACTIVE') },
  { id: 'usr_example_0004', email: 'cynthia.example@careos.example', firstName: 'Cynthia', lastName: 'Wanjiru', otherNames: 'Njeri', phone: null, status: 'INVITED', createdAt: '2026-03-20T14:30:00.000Z', roles: [adminRoleRef('NURSE')], staff: null },
  { id: 'usr_example_0005', email: 'daniel.example@careos.example', firstName: 'Daniel', lastName: 'Otieno', otherNames: null, phone: '+254700000005', status: 'SUSPENDED', createdAt: '2026-04-02T07:45:00.000Z', roles: [adminRoleRef('ACCOUNTANT')], staff: adminStaff('stf_example_0005', 'STF-0005', 'Accounts Officer', 'Finance', 'ON_LEAVE') },
  { id: 'usr_example_0006', email: 'esther.example@careos.example', firstName: 'Esther', lastName: 'Achieng', otherNames: null, phone: '+254700000006', status: 'ACTIVE', createdAt: '2026-04-19T10:10:00.000Z', roles: [adminRoleRef('HOSPITAL_ADMIN'), adminRoleRef('LAB_TECHNICIAN')], staff: adminStaff('stf_example_0006', 'STF-0006', 'Laboratory Manager', 'Haematology', 'ACTIVE') },
  { id: 'usr_example_0007', email: 'felix.example@careos.example', firstName: 'Felix', lastName: 'Mutua', otherNames: null, phone: null, status: 'DEACTIVATED', createdAt: '2026-05-06T16:00:00.000Z', roles: [adminRoleRef('PHARMACIST')], staff: null },
];
let adminUserSeq = 8;
let adminRoleSeq = 10;
const ADMIN_ROLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const LIVE_ROLE_CATALOG = {
  groups: LIVE_ADMIN_ROLES.map((entry) => ({ key: entry.key, name: entry.name, permissions: [...entry.permissions] })),
  systemRoles: LIVE_ADMIN_ROLES.filter((entry) => entry.isSystem).map((entry) => entry.key),
  permissionGroups: {
    organizations: { read: 'organizations.read', manage: 'organizations.manage' },
    branches: { read: 'branches.read', manage: 'branches.manage' },
    departments: { read: 'departments.read', manage: 'departments.manage' },
    users: { read: 'users.read', manage: 'users.manage' },
    roles: { read: 'roles.read', manage: 'roles.manage' },
    sessions: { read: 'sessions.read', manage: 'sessions.manage' },
    staff: { read: 'staff.read', manage: 'staff.manage' },
    patients: { read: 'patients.read', create: 'patients.create', update: 'patients.update', manage: 'patients.manage' },
    appointments: { read: 'appointments.read', create: 'appointments.create', manage: 'appointments.manage' },
    queue: { read: 'queue.read', create: 'queue.create', manage: 'queue.manage' },
    vitals: { read: 'vitals.read', record: 'vitals.record' },
    encounters: { read: 'encounters.read', create: 'encounters.create', update: 'encounters.update' },
    clinicalNotes: { read: 'clinical_notes.read', create: 'clinical_notes.create', update: 'clinical_notes.update' },
    prescriptions: { read: 'prescription.read', create: 'prescription.create', cancel: 'prescription.cancel' },
    lab: { read: 'lab.read', order: 'lab.order', process: 'lab.process', verify: 'lab.verify', release: 'lab.release' },
    radiology: { read: 'radiology.read', order: 'radiology.order', verify: 'radiology.verify', release: 'radiology.release' },
    pharmacy: { dispense: 'pharmacy.dispense', inventory: 'pharmacy.inventory' },
    inventory: { read: 'inventory.read', manage: 'inventory.manage', wastage: 'inventory.wastage' },
    billing: { read: 'billing.read', create: 'billing.create', manage: 'billing.manage' },
    insurance: { read: 'insurance.read', manage: 'insurance.manage' },
    wards: { read: 'wards.read', manage: 'wards.manage' },
    beds: { read: 'beds.read', manage: 'beds.manage' },
    inpatient: { read: 'inpatient.read', create: 'inpatient.create', transfer: 'inpatient.transfer', discharge: 'inpatient.discharge' },
    emergency: { read: 'emergency.read', register: 'emergency.register', triage: 'emergency.triage', manage: 'emergency.manage' },
    reports: { read: 'reports.read' },
    analytics: { read: 'analytics.read' },
    audit: { read: 'audit.read' },
  },
};
const ADMIN_CALLER_ID = 'usr_example_0001';
const ADMIN_USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'];
function findAdminUser(id) { return LIVE_ADMIN_USERS.find((user) => user.id === id); }
function findAdminRole(id) { return LIVE_ADMIN_ROLES.find((role) => role.id === id); }
function resolveAdminRoles(roleIds) {
  const refs = [];
  const seen = new Set();
  for (const id of roleIds) {
    if (seen.has(id)) continue;
    const role = findAdminRole(id);
    if (!role) return null;
    refs.push({ id: role.id, key: role.key, name: role.name });
    seen.add(id);
  }
  return refs;
}
function adminStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

// F9 staff directory fixtures, mirroring src/mocks/fixtures/staff-registry.ts.
// Profiles are derived from LIVE_ADMIN_USERS so identity cannot drift, and
// assignments are held as id lists resolved to joined refs on read.
const STAFF_BRANCHES = [
  { id: 'br_example_0001', name: 'EXAMPLE Main Campus', code: 'MAIN', address: 'EXAMPLE 12 Hospital Road, Nairobi', phone: '+254700100001', email: 'main@example.org', operatingHours: 'Mon–Sat 08:00–20:00', status: 'ACTIVE', createdAt: '2026-01-03T06:00:00.000Z' },
  { id: 'br_example_0002', name: 'EXAMPLE Westlands Clinic', code: 'WEST', address: 'EXAMPLE 5 Ring Road, Nairobi', phone: '+254700100002', email: 'westlands@example.org', operatingHours: 'Mon–Fri 08:00–17:00', status: 'ACTIVE', createdAt: '2026-02-01T06:00:00.000Z' },
];
const STAFF_EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'CONTRACT'];
const ADMIN_STAFF_ASSIGNMENTS = {
  stf_example_0002: { branchIds: ['br_example_0001'], departmentIds: ['dep_example_outpatient'], licenseNumber: 'KMPDC-1234' },
  stf_example_0003: { branchIds: ['br_example_0001', 'br_example_0002'], departmentIds: ['dep_example_outpatient'], licenseNumber: null },
  stf_example_0005: { branchIds: ['br_example_0002'], departmentIds: [], licenseNumber: null },
  stf_example_0006: { branchIds: ['br_example_0001'], departmentIds: ['dep_example_outpatient', 'dep_example_emergency'], licenseNumber: 'KMLTTB-778' },
};
function findStaffBranch(id) { return STAFF_BRANCHES.find((branch) => branch.id === id); }
function findStaffDepartment(id) { return DEPARTMENTS.find((department) => department.id === id); }
function findAdminStaff(id) { return LIVE_ADMIN_STAFF.find((entry) => entry.id === id); }
const LIVE_ADMIN_STAFF = LIVE_ADMIN_USERS.filter((user) => user.staff).map((user) => {
  const assignment = ADMIN_STAFF_ASSIGNMENTS[user.staff.id] || { branchIds: [], departmentIds: [], licenseNumber: null };
  return {
    id: user.staff.id,
    staffNumber: user.staff.staffNumber,
    professionalTitle: user.staff.professionalTitle,
    specialization: user.staff.specialization,
    employmentStatus: user.staff.employmentStatus,
    licenseNumber: assignment.licenseNumber,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, status: user.status },
    branchIds: [...assignment.branchIds],
    departmentIds: [...assignment.departmentIds],
  };
});
function serializeStaff(entry) {
  return {
    id: entry.id,
    staffNumber: entry.staffNumber,
    professionalTitle: entry.professionalTitle,
    specialization: entry.specialization,
    employmentStatus: entry.employmentStatus,
    licenseNumber: entry.licenseNumber,
    user: { ...entry.user },
    branches: entry.branchIds.flatMap((id) => { const branch = findStaffBranch(id); return branch ? [{ id: branch.id, name: branch.name, code: branch.code }] : []; }),
    departments: entry.departmentIds.flatMap((id) => { const department = findStaffDepartment(id); return department ? [{ id: department.id, name: department.name }] : []; }),
  };
}

// F9 organization profile, mirroring src/mocks/fixtures/admin-registry.ts ORGANIZATION.
const LIVE_ORGANIZATION = {
  id: 'org_example_1',
  name: 'EXAMPLE CareOS Hospital',
  status: 'ACTIVE',
  legalName: 'EXAMPLE CareOS Hospital Limited',
  tradingName: null,
  registrationNumber: 'EXAMPLE-CPR-2026-001',
  kraPin: 'EXAMPLE-P000000000X',
  phone: '+254700000001',
  email: 'info@careos.example',
  website: 'https://careos.example',
  logoUrl: null,
  address: 'EXAMPLE 12 Hospital Road',
  county: 'Nairobi',
  town: 'Nairobi',
  currency: 'KES',
  timezone: 'Africa/Nairobi',
  country: 'KE',
  createdAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-02-01T08:00:00.000Z',
};
const ORGANIZATION_EDITABLE = ['legalName', 'tradingName', 'registrationNumber', 'kraPin', 'phone', 'email', 'website', 'logoUrl', 'address', 'county', 'town'];

// F10 reports (report-export desk). Mirrored from src/mocks/fixtures/report-registry.ts
// so mock dev and the production build's e2e run cannot silently drift.
let REPORT_SEQ = 5;
const LIVE_REPORTS = [
  {
    id: 'rep_example_0001',
    reportType: 'PATIENT',
    format: 'JSON',
    status: 'READY',
    contentType: 'application/json',
    sizeBytes: 2048,
    summary: { total: 12, sexes: { MALE: 7, FEMALE: 5 } },
    error: null,
    expiresAt: '2026-03-02T08:00:00.000Z',
    createdAt: '2026-03-01T08:00:00.000Z',
    completedAt: '2026-03-01T08:00:12.000Z',
  },
  {
    id: 'rep_example_0002',
    reportType: 'FINANCIAL',
    format: 'CSV',
    status: 'PENDING',
    contentType: 'text/csv',
    sizeBytes: null,
    summary: null,
    error: null,
    expiresAt: '2026-03-02T08:05:00.000Z',
    createdAt: '2026-03-01T08:05:00.000Z',
    completedAt: null,
  },
  {
    id: 'rep_example_0003',
    reportType: 'LABORATORY',
    format: 'PDF',
    status: 'FAILED',
    contentType: 'application/pdf',
    sizeBytes: null,
    summary: null,
    error: 'Render failed: a required glyph was missing from the PDF font.',
    expiresAt: '2026-03-02T07:30:00.000Z',
    createdAt: '2026-03-01T07:30:00.000Z',
    completedAt: '2026-03-01T07:30:04.000Z',
  },
  {
    id: 'rep_example_0004',
    reportType: 'APPOINTMENT',
    format: 'CSV',
    status: 'EXPIRED',
    contentType: 'text/csv',
    sizeBytes: 5120,
    summary: { total: 40, noShowRate: 12.5 },
    error: null,
    expiresAt: '2026-02-28T06:00:00.000Z',
    createdAt: '2026-02-27T06:00:00.000Z',
    completedAt: '2026-02-27T06:00:08.000Z',
  },
];
const REPORT_TYPES = ['PATIENT', 'APPOINTMENT', 'CLINICAL_OPERATIONS', 'LABORATORY', 'PHARMACY', 'FINANCIAL', 'INSURANCE', 'OPERATIONS'];
const REPORT_FORMATS = ['JSON', 'CSV', 'PDF'];
const REPORT_CONTENT_TYPES = { JSON: 'application/json', CSV: 'text/csv', PDF: 'application/pdf' };



const PRESCRIPTION_ACTIONS_BY_STATUS = {
  DRAFT: ['issue', 'cancel'],
  ISSUED: ['cancel'],
  PARTIALLY_DISPENSED: ['cancel'],
  DISPENSED: [],
  CANCELLED: [],
};
function serializePrescription(prescription) {
  // The live DTO omits createdAt; the rest of the row goes out exactly as typed.
  const body = { ...prescription };
  delete body._items;
  delete body.createdAt;
  return { ...body, items: prescription._items.map((item) => ({ ...item })) };
}
function validatePrescriptionItems(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    if (typeof entry.medicationId !== 'string') return null;
    const medication = LIVE_MEDICATIONS.find((m) => m.id === entry.medicationId);
    if (!medication) return null;
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return null;
    items.push({ id: `pri_example_${prxItemSeq++}`, medicationId: entry.medicationId, quantity, dispensedQuantity: 0, dosage: typeof entry.dosage === 'string' && entry.dosage.trim().length > 0 ? entry.dosage.trim() : null, frequency: typeof entry.frequency === 'string' && entry.frequency.trim().length > 0 ? entry.frequency.trim() : null, durationDays: Number.isInteger(Number(entry.durationDays)) ? Number(entry.durationDays) : null, instructions: typeof entry.instructions === 'string' && entry.instructions.trim().length > 0 ? entry.instructions.trim() : null });
  }
  return items;
}

// --- laboratory + radiology results (F4 doctor results view) --------------
// Same contract and records as the MSW handlers. The lab list is a thin
// projection (no results, no test names); the detail route carries them.
// Radiology serializes the full order including its report.
const LAB_TEST_SEED = [
  { id: 'lbt_example_5001', code: 'CBC', name: 'EXAMPLE Full blood count', sampleType: 'BLOOD', isActive: true, fields: [
    { id: 'lbf_example_5101', name: 'Haemoglobin', fieldType: 'NUMERIC', unit: 'g/dL', referenceMin: '12', referenceMax: '16', criticalMin: '7', criticalMax: '20', allowsValues: null, displayOrder: 1, isActive: true },
    { id: 'lbf_example_5102', name: 'White cell count', fieldType: 'NUMERIC', unit: '10^9/L', referenceMin: '4', referenceMax: '11', criticalMin: '1', criticalMax: '30', allowsValues: null, displayOrder: 2, isActive: true },
    { id: 'lbf_example_5103', name: 'Platelets', fieldType: 'NUMERIC', unit: '10^9/L', referenceMin: '150', referenceMax: '400', criticalMin: '20', criticalMax: '1000', allowsValues: null, displayOrder: 3, isActive: true },
  ] },
  { id: 'lbt_example_5002', code: 'U&E', name: 'EXAMPLE Urea and electrolytes', sampleType: 'BLOOD', isActive: true, fields: [
    { id: 'lbf_example_5201', name: 'Sodium', fieldType: 'NUMERIC', unit: 'mmol/L', referenceMin: '135', referenceMax: '145', criticalMin: '120', criticalMax: '155', allowsValues: null, displayOrder: 1, isActive: true },
    { id: 'lbf_example_5202', name: 'Potassium', fieldType: 'NUMERIC', unit: 'mmol/L', referenceMin: '3.5', referenceMax: '5.3', criticalMin: '2.5', criticalMax: '6.5', allowsValues: null, displayOrder: 2, isActive: true },
    { id: 'lbf_example_5203', name: 'Creatinine', fieldType: 'NUMERIC', unit: 'mg/dL', referenceMin: '0.6', referenceMax: '1.3', criticalMin: '0.2', criticalMax: '4', allowsValues: null, displayOrder: 3, isActive: true },
  ] },
];
const LIVE_LAB_TESTS = LAB_TEST_SEED.map((test) => ({
  ...test, organizationId: 'org_example_0001', categoryId: null, specimenInstructions: null, version: 1,
  fields: test.fields.map((field) => ({ ...field, organizationId: 'org_example_0001', testId: test.id })),
}));
let labItemSeq = 6200;
let labResultSeq = 6300;
let labCriticalSeq = 6400;
let labCreatedOrderSeq = 7001;
let labCreatedSampleSeq = 7101;
const LAB_ORDER_SEED = [
  { id: 'lab_example_5001', orderNumber: 'LAB-2026-000001', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'RELEASED', priority: 'ROUTINE', orderedMinutesAgo: 35, releasedMinutesAgo: 10, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: null, sampleNumber: 'S-2026-000001', items: [
    { testId: 'lbt_example_5001', notes: null, results: [
      { testFieldId: 'lbf_example_5101', value: '13.4', isAbnormal: false, isCritical: false },
      { testFieldId: 'lbf_example_5102', value: '12.8', isAbnormal: true, isCritical: false },
      { testFieldId: 'lbf_example_5103', value: '245', isAbnormal: false, isCritical: false },
    ] },
  ] },
  { id: 'lab_example_5002', orderNumber: 'LAB-2026-000002', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'RELEASED', priority: 'URGENT', orderedMinutesAgo: 30, releasedMinutesAgo: 4, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: 'Repeat in 24 hours.', sampleNumber: 'S-2026-000002', items: [
    { testId: 'lbt_example_5002', notes: 'Repeat in 24 hours.', results: [
      { testFieldId: 'lbf_example_5201', value: '138', isAbnormal: false, isCritical: false },
      { testFieldId: 'lbf_example_5202', value: '6.2', isAbnormal: true, isCritical: true, acknowledged: true },
      { testFieldId: 'lbf_example_5203', value: '1.1', isAbnormal: false, isCritical: false },
    ] },
  ] },
  { id: 'lab_example_5003', orderNumber: 'LAB-2026-000003', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'PROCESSING', priority: 'ROUTINE', orderedMinutesAgo: 20, releasedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: null, sampleNumber: 'S-2026-000003', items: [
    { testId: 'lbt_example_5001', notes: null, results: [] },
  ] },
  { id: 'lab_example_5004', orderNumber: 'LAB-2026-000004', patientId: 'pat_example_1002', encounterId: 'enc_example_6002', status: 'RELEASED', priority: 'STAT', orderedMinutesAgo: 55, releasedMinutesAgo: 12, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: null, sampleNumber: 'S-2026-000004', items: [
    { testId: 'lbt_example_5001', notes: null, results: [{ testFieldId: 'lbf_example_5101', value: '9.4', isAbnormal: true, isCritical: false }] },
  ] },
  { id: 'lab_example_5005', orderNumber: 'LAB-2026-000005', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'ORDERED', priority: 'ROUTINE', orderedMinutesAgo: 8, releasedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: null, sampleNumber: 'S-2026-000005', items: [
    { testId: 'lbt_example_5002', notes: null, results: [] },
  ] },
  { id: 'lab_example_5006', orderNumber: 'LAB-2026-000006', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'COLLECTED', priority: 'ROUTINE', orderedMinutesAgo: 15, releasedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: null, sampleNumber: 'S-2026-000006', items: [
    { testId: 'lbt_example_5001', notes: null, results: [] },
  ] },
  { id: 'lab_example_5007', orderNumber: 'LAB-2026-000007', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'RECEIVED', priority: 'URGENT', orderedMinutesAgo: 45, releasedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: null, sampleNumber: 'S-2026-000007', items: [
    { testId: 'lbt_example_5002', notes: null, results: [] },
  ] },
  { id: 'lab_example_5008', orderNumber: 'LAB-2026-000010', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'RESULT_READY', priority: 'STAT', orderedMinutesAgo: 50, releasedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: null, clinicalNotes: 'Fever and confusion.', sampleNumber: 'S-2026-000008', items: [
    { testId: 'lbt_example_5002', notes: null, results: [
      { testFieldId: 'lbf_example_5201', value: '134', isAbnormal: false, isCritical: false },
      { testFieldId: 'lbf_example_5202', value: '6.8', isAbnormal: true, isCritical: true },
      { testFieldId: 'lbf_example_5203', value: '1.4', isAbnormal: true, isCritical: false },
    ] },
  ] },
  { id: 'lab_example_5009', orderNumber: 'LAB-2026-000011', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'REJECTED', priority: 'ROUTINE', orderedMinutesAgo: 90, releasedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, rejectionReason: 'EXAMPLE Haemolysed sample — recollection requested.', clinicalNotes: null, sampleNumber: 'S-2026-000009', items: [
    { testId: 'lbt_example_5001', notes: null, results: [] },
  ] },
  { id: 'lab_example_5010', orderNumber: 'LAB-2026-000012', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', status: 'CANCELLED', priority: 'ROUTINE', orderedMinutesAgo: 60, releasedMinutesAgo: null, cancelledMinutesAgo: 50, cancelReason: 'Duplicate of an earlier request.', rejectionReason: null, clinicalNotes: null, sampleNumber: 'S-2026-000010', items: [
    { testId: 'lbt_example_5001', notes: null, results: [] },
  ] },
];
function labSampleStatusFor(status) {
  switch (status) {
    case 'ORDERED': return 'ORDERED';
    case 'COLLECTED': return 'COLLECTED';
    case 'RECEIVED': return 'RECEIVED';
    case 'PROCESSING': return 'PROCESSING';
    case 'REJECTED': return 'REJECTED';
    case 'CANCELLED': return 'ORDERED';
    default: return 'COMPLETED';
  }
}
function buildLabOrder(seed) {
  const criticalResults = [];
  const sampleStatus = labSampleStatusFor(seed.status);
  const sample = {
    id: `lbs_example_${6000 + LAB_ORDER_SEED.indexOf(seed) + 1}`,
    organizationId: 'org_example_0001', sampleNumber: seed.sampleNumber, orderId: seed.id,
    patientId: seed.patientId, branchId: 'br_example_0001', sampleType: 'BLOOD', status: sampleStatus,
    collectedAt: sampleStatus === 'ORDERED' ? null : minutesAgo(Math.max(seed.orderedMinutesAgo - 2, 0)),
    receivedAt: ['RECEIVED', 'PROCESSING', 'COMPLETED'].includes(sampleStatus) ? minutesAgo(Math.max(seed.orderedMinutesAgo - 4, 0)) : null,
    processingAt: ['PROCESSING', 'COMPLETED'].includes(sampleStatus) ? minutesAgo(Math.max(seed.orderedMinutesAgo - 6, 0)) : null,
    completedAt: sampleStatus === 'COMPLETED' ? minutesAgo(Math.max(seed.orderedMinutesAgo - 8, 0)) : null,
    rejectedAt: sampleStatus === 'REJECTED' ? minutesAgo(Math.max(seed.orderedMinutesAgo - 10, 0)) : null,
    rejectedReason: sampleStatus === 'REJECTED' ? seed.rejectionReason : null,
    recollectsFromOrderId: null,
  };
  const _items = seed.items.map((item) => {
    const test = LIVE_LAB_TESTS.find((t) => t.id === item.testId);
    const itemId = `loi_example_${labItemSeq++}`;
    return { id: itemId, testId: item.testId, testCode: test?.code ?? '', testName: test?.name ?? '', notes: item.notes, results: item.results.map((result) => {
      const resultId = `lbr_example_${labResultSeq++}`;
      if (result.isCritical) {
        const acknowledged = result.acknowledged === true;
        criticalResults.push({ id: `lcr_example_${labCriticalSeq++}`, organizationId: 'org_example_0001', resultId, notifiedToId: 'usr_example_9001', notifiedAt: minutesAgo(Math.max(seed.orderedMinutesAgo - 1, 0)), acknowledgedById: acknowledged ? 'usr_example_9002' : null, acknowledgedAt: acknowledged ? minutesAgo(Math.max((seed.releasedMinutesAgo ?? 1) - 1, 0)) : null, escalationAt: null });
      }
      return { id: resultId, organizationId: 'org_example_0001', orderItemId: itemId, testFieldId: result.testFieldId, value: result.value, isAbnormal: result.isAbnormal, isCritical: result.isCritical, currentVersion: 1, amendments: 0 };
    }) };
  });
  return {
    id: seed.id, organizationId: 'org_example_0001', orderNumber: seed.orderNumber, patientId: seed.patientId,
    branchId: 'br_example_0001', encounterId: seed.encounterId, status: seed.status, priority: seed.priority,
    clinicalNotes: seed.clinicalNotes, orderedById: 'usr_example_9001', orderedAt: minutesAgo(seed.orderedMinutesAgo),
    releasedById: seed.releasedMinutesAgo === null ? null : 'usr_example_9002',
    releasedAt: seed.releasedMinutesAgo === null ? null : minutesAgo(seed.releasedMinutesAgo), cancelledById: null,
    cancelledAt: seed.cancelledMinutesAgo === null ? null : minutesAgo(seed.cancelledMinutesAgo), cancelledReason: seed.cancelReason,
    rejectionReason: seed.rejectionReason, version: 1, sample, _items, criticalResults,
  };
}
const LIVE_LAB_ORDERS = LAB_ORDER_SEED.map(buildLabOrder);
function serializeLabOrderSummary(order) {
  const { _items, criticalResults, ...header } = order;
  void criticalResults;
  return { ...header, items: _items.map((item) => ({ id: item.id, testId: item.testId })) };
}
function serializeLabOrderDetail(order) {
  const { _items, ...header } = order;
  return { ...header, items: _items };
}
function labFieldIndex() {
  const index = new Map();
  for (const test of LIVE_LAB_TESTS) {
    for (const field of test.fields) index.set(field.id, field);
  }
  return index;
}
function classifyLabValue(field, value) {
  if (!field || field.fieldType !== 'NUMERIC') return { isAbnormal: false, isCritical: false };
  const num = Number(value);
  if (!Number.isFinite(num)) return { isAbnormal: false, isCritical: false };
  const above = (bound) => bound !== null && bound !== undefined && num > Number(bound);
  const below = (bound) => bound !== null && bound !== undefined && num < Number(bound);
  const isCritical = below(field.criticalMin) || above(field.criticalMax);
  const isAbnormal = isCritical || below(field.referenceMin) || above(field.referenceMax);
  return { isAbnormal, isCritical };
}
const RADIOLOGY_ORDER_SEED = [
  { id: 'rad_example_4001', orderNumber: 'RAD-2026-000001', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', modality: 'XRAY', region: 'Chest', status: 'RELEASED', clinicalNotes: 'Persistent productive cough, query pneumonia.', orderedMinutesAgo: 38, requestedMinutesAgo: 36, performedMinutesAgo: 20, cancelledMinutesAgo: null, cancelReason: null, releasedMinutesAgo: 6, report: { id: 'imr_example_4001', findings: 'No focal consolidation or effusion. Cardiothoracic ratio within normal limits.', summary: 'Normal chest radiograph.', impression: 'No acute cardiopulmonary abnormality.', enteredMinutesAgo: 14, verifiedMinutesAgo: 8 } },
  { id: 'rad_example_4002', orderNumber: 'RAD-2026-000002', patientId: 'pat_example_1001', encounterId: 'enc_example_6001', modality: 'ULTRASOUND', region: 'Abdomen', status: 'SCHEDULED', clinicalNotes: 'Right upper quadrant pain.', orderedMinutesAgo: 5, requestedMinutesAgo: 3, performedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, releasedMinutesAgo: null, report: null },
  { id: 'rad_example_4003', orderNumber: 'RAD-2026-000003', patientId: 'pat_example_1002', encounterId: 'enc_example_6002', modality: 'CT', region: 'Head', status: 'RELEASED', clinicalNotes: 'Sudden onset headache.', orderedMinutesAgo: 50, requestedMinutesAgo: 48, performedMinutesAgo: 30, cancelledMinutesAgo: null, cancelReason: null, releasedMinutesAgo: 15, report: { id: 'imr_example_4003', findings: 'No intracranial haemorrhage. Grey-white differentiation preserved.', summary: 'Unremarkable non-contrast CT head.', impression: 'No acute intracranial abnormality.', enteredMinutesAgo: 25, verifiedMinutesAgo: 18 } },
  { id: 'rad_example_4004', orderNumber: 'RAD-2026-000004', patientId: 'pat_example_1003', encounterId: 'enc_example_6003', modality: 'MRI', region: 'Knee', status: 'ORDERED', clinicalNotes: 'Twisted knee; query meniscal tear.', orderedMinutesAgo: 2, requestedMinutesAgo: null, performedMinutesAgo: null, cancelledMinutesAgo: null, cancelReason: null, releasedMinutesAgo: null, report: null },
  { id: 'rad_example_4005', orderNumber: 'RAD-2026-000005', patientId: 'pat_example_1004', encounterId: null, modality: 'XRAY', region: 'Chest', status: 'PERFORMED', clinicalNotes: 'Pre-operative assessment.', orderedMinutesAgo: 40, requestedMinutesAgo: 38, performedMinutesAgo: 10, cancelledMinutesAgo: null, cancelReason: null, releasedMinutesAgo: null, report: null },
  { id: 'rad_example_4006', orderNumber: 'RAD-2026-000006', patientId: 'pat_example_1003', encounterId: null, modality: 'CT', region: 'Abdomen', status: 'REPORTED', clinicalNotes: 'Recurrent abdominal pain.', orderedMinutesAgo: 60, requestedMinutesAgo: 58, performedMinutesAgo: 25, cancelledMinutesAgo: null, cancelReason: null, releasedMinutesAgo: null, report: { id: 'imr_example_4006', findings: 'No bowel obstruction. Mild fat stranding in the right iliac fossa.', summary: 'Mild inflammatory change.', impression: 'Probable early appendicitis; correlate clinically.', enteredMinutesAgo: 8, verifiedMinutesAgo: null } },
  { id: 'rad_example_4007', orderNumber: 'RAD-2026-000007', patientId: 'pat_example_1002', encounterId: null, modality: 'MRI', region: 'Spine', status: 'VERIFIED', clinicalNotes: 'Chronic low back pain.', orderedMinutesAgo: 90, requestedMinutesAgo: 88, performedMinutesAgo: 50, cancelledMinutesAgo: null, cancelReason: null, releasedMinutesAgo: null, report: { id: 'imr_example_4007', findings: 'L4/L5 disc bulge without nerve root compression.', summary: 'Degenerative disc disease.', impression: 'No surgical target identified.', enteredMinutesAgo: 30, verifiedMinutesAgo: 12 } },
  { id: 'rad_example_4008', orderNumber: 'RAD-2026-000008', patientId: 'pat_example_1004', encounterId: null, modality: 'ULTRASOUND', region: 'Pelvis', status: 'CANCELLED', clinicalNotes: 'Query ovarian pathology.', orderedMinutesAgo: 20, requestedMinutesAgo: null, performedMinutesAgo: null, cancelledMinutesAgo: 15, cancelReason: 'Patient declined; imaging to be rescheduled.', releasedMinutesAgo: null, report: null },
];
let radiologyReportSeq = 4100;
let radiologyCreatedOrderSeq = 4501;
const LIVE_RADIOLOGY_ORDERS = RADIOLOGY_ORDER_SEED.map((seed) => ({
  id: seed.id, organizationId: 'org_example_0001', orderNumber: seed.orderNumber, patientId: seed.patientId,
  branchId: 'br_example_0001', encounterId: seed.encounterId, modality: seed.modality, region: seed.region,
  status: seed.status, clinicalNotes: seed.clinicalNotes, orderedById: 'usr_example_9001', orderedAt: minutesAgo(seed.orderedMinutesAgo),
  requestedAt: seed.requestedMinutesAgo === null ? null : minutesAgo(seed.requestedMinutesAgo),
  performedById: seed.performedMinutesAgo === null ? null : 'usr_example_9002',
  performedAt: seed.performedMinutesAgo === null ? null : minutesAgo(seed.performedMinutesAgo),
  cancelledById: seed.cancelledMinutesAgo === null ? null : 'usr_example_9001',
  cancelledAt: seed.cancelledMinutesAgo === null ? null : minutesAgo(seed.cancelledMinutesAgo),
  cancelledReason: seed.cancelReason,
  releasedById: seed.releasedMinutesAgo === null ? null : 'usr_example_9003',
  releasedAt: seed.releasedMinutesAgo === null ? null : minutesAgo(seed.releasedMinutesAgo), version: 1,
  report: seed.report ? { id: seed.report.id, organizationId: 'org_example_0001', orderId: seed.id, findings: seed.report.findings, summary: seed.report.summary, impression: seed.report.impression, enteredById: seed.report.enteredMinutesAgo === null ? null : 'usr_example_9002', enteredAt: seed.report.enteredMinutesAgo === null ? null : minutesAgo(seed.report.enteredMinutesAgo), verifiedById: seed.report.verifiedMinutesAgo === null ? null : 'usr_example_9003', verifiedAt: seed.report.verifiedMinutesAgo === null ? null : minutesAgo(seed.report.verifiedMinutesAgo), version: 1 } : null,
}));

function serializeNote(note) {
  const body = { ...note };
  delete body._versions;
  return body;
}
function serializeNoteWithVersions(note) {
  const { _versions, ...body } = note;
  return { ...body, versions: _versions.map(({ id, versionNumber, kind, title, sections, reason, authorId, createdAt }) => ({ id, versionNumber, kind, title, sections, reason, authorId, createdAt })) };
}
function validateNoteSections(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const sections = {};
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string' || !NOTE_SECTION_KEYS.includes(key)) return null;
    sections[key] = text;
  }
  return sections;
}

function computeBmi(weightKg, heightCm) {
  if (weightKg === null || heightCm === null || !Number.isFinite(weightKg) || !Number.isFinite(heightCm) || weightKg <= 0 || heightCm <= 0 || heightCm < 60 || heightCm > 260 || weightKg < 1 || weightKg > 500) return null;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}
function bmiCategory(bmi) {
  if (bmi === null) return null;
  if (bmi < 18.5) return 'UNDERWEIGHT';
  if (bmi < 25) return 'NORMAL';
  if (bmi < 30) return 'OVERWEIGHT';
  return 'OBESE';
}
function serializeVital(vital) {
  const bmi = computeBmi(vital.weightKg, vital.heightCm);
  return { ...vital, bmi, bmiCategory: bmiCategory(bmi) };
}
function measurementsOf(body) {
  const data = {};
  for (const field of VITAL_MEASUREMENTS) data[field] = typeof body[field] === 'number' ? body[field] : null;
  return data;
}
function hasVitalContent(body) {
  if (typeof body.notes === 'string' && body.notes.trim().length > 0) return true;
  return VITAL_MEASUREMENTS.some((field) => typeof body[field] === 'number');
}

function generateSlots(providerId, departmentId, dateISO) {
  const day = utcDayStart(dateISO);
  const dayIndex = workdayIndexFor(day);
  const overrides = LIVE_OVERRIDES.filter((o) => o.providerId === providerId && o.date === dateISO);
  if (overrides.some((o) => o.type !== 'WORKING')) return [];
  const working = overrides.filter((o) => o.type === 'WORKING');
  const windows = working.length
    ? working.map((o) => ({ startMinutes: o.startMinutes ?? 0, endMinutes: o.endMinutes ?? 1440, slotDurationMinutes: o.slotDurationMinutes ?? 30, capacity: o.capacity ?? 1 }))
    : SCHEDULE_TEMPLATES.filter((t) => t.providerId === providerId && t.departmentId === departmentId && t.dayOfWeek === dayIndex)
        .map((t) => ({ startMinutes: t.startMinutes, endMinutes: t.endMinutes, slotDurationMinutes: t.slotDurationMinutes, capacity: t.capacity }));
  const bookings = APPOINTMENTS.filter((a) => a.providerId === providerId && businessDayKey(a.startsAt) === dateISO && APPOINTMENT_OCCUPYING.has(a.status));
  const now = Date.now();
  const slots = [];
  for (const window of windows) {
    for (let start = window.startMinutes; start + window.slotDurationMinutes <= window.endMinutes; start += window.slotDurationMinutes) {
      const startsAt = new Date(day.getTime() + start * 60000);
      const endsAt = new Date(startsAt.getTime() + window.slotDurationMinutes * 60000);
      const booked = bookings.filter((b) => b.startsAt === startsAt.toISOString()).length;
      const remaining = Math.max(0, window.capacity - booked);
      let status = 'AVAILABLE';
      if (remaining <= 0) status = 'FULL';
      else if (startsAt.getTime() <= now) status = 'PAST';
      slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), capacity: window.capacity, booked, remaining, status });
    }
  }
  slots.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return slots;
}
function listEnvelope(items, limit = 100) {
  return { success: true, data: items, meta: { page: 1, limit, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / limit)) } };
}

function queueStats() {
  const callWaits = QUEUE.filter((e) => e.calledAt).map((e) => (Date.parse(e.calledAt) - Date.parse(e.enteredAt)) / 60000);
  const services = QUEUE.filter((e) => e.serviceStartedAt && e.completedAt).map((e) => (Date.parse(e.completedAt) - Date.parse(e.serviceStartedAt)) / 60000);
  const left = QUEUE.filter((e) => e.status === 'ABANDONED' || e.status === 'NO_SHOW').length;
  const avg = (values) => (values.length === 0 ? null : Math.round(values.reduce((s, v) => s + v, 0) / values.length));
  return { avgCallWaitMinutes: avg(callWaits), avgServiceMinutes: avg(services), abandonmentRate: QUEUE.length === 0 ? 0 : Math.round(left / QUEUE.length * 100) / 100, currentlyWaiting: QUEUE.filter((e) => e.status === 'WAITING').length };
}


function send(response, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }

  // Published facilities, per the live contract: `GET /public/facilities/search`
  // returns a flat `{ success, data: […] }` array (there is no `{ items, total }`
  // envelope and no `/public/facilities` path upstream). The `q` query is the
  // API's real free-text search, exercised here over name/address/town. Facets
  // (`open24h`, `emergency24h`, `ambulanceAvailable`) are the live fields; the
  // partial document's `type`/`status` enums do not exist upstream, so no stub
  // data fabricates them. All records are fabricated.
  const FACILITIES = [
    {
      id: 'fac-example-1',
      slug: 'example-general-hospital',
      name: 'EXAMPLE General Hospital',
      summary: 'EXAMPLE 24-hour casualty with online emergency intake.',
      town: 'Mombasa',
      county: 'Mombasa County',
      address: '1 Independence Avenue, Mombasa',
      phone: '+254 700 000 111',
      open24h: true,
      emergency24h: true,
      ambulanceAvailable: true,
      emergencyIntakeEnabled: true,
    },
    {
      id: 'fac-example-2',
      slug: 'example-referral-centre',
      name: 'EXAMPLE Referral Centre',
      summary: 'EXAMPLE regional referral centre.',
      town: 'Nairobi',
      county: 'Nairobi County',
      address: '22 Hospital Road, Nairobi',
      phone: '+254 700 000 222',
      open24h: true,
      emergency24h: false,
      ambulanceAvailable: true,
      emergencyIntakeEnabled: false,
    },
    {
      id: 'fac-example-3',
      slug: 'example-community-clinic',
      name: 'EXAMPLE Community Clinic',
      summary: 'EXAMPLE daytime community clinic.',
      town: 'Kisumu',
      county: 'Kisumu County',
      address: '3 Market Street, Kisumu',
      open24h: false,
      emergency24h: false,
      ambulanceAvailable: false,
      emergencyIntakeEnabled: false,
    },
  ];
  if (url.pathname === '/public/facilities/search' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    let items = FACILITIES;
    if (q) {
      items = items.filter((facility) =>
        `${facility.name} ${facility.address ?? ''} ${facility.town ?? ''}`
          .toLowerCase()
          .includes(q),
      );
    }
    send(response, 200, { success: true, data: items });
    return;
  }

  if (url.pathname === '/public/emergency-requests' && request.method === 'POST') {
    const cookies = request.headers.cookie ?? '';

    // Rate limited, for the error-path test.
    if (cookies.includes('careos-e2e=rate-limited')) {
      send(response, 429, { success: false, error: { code: 'RATE_LIMITED', message: 'stub' } });
      return;
    }

    // Deliberately validates: the form's own client validation is not the only
    // line of defence, and a stub that accepted anything would hide a form that
    // posts an invalid body. The live body is slug-keyed (`SubmitEmergencyRequestDto`).
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'bad json' },
        });
        return;
      }

      if (typeof parsed.slug !== 'string' || parsed.slug.length === 0) {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid', details: ['slug'] },
        });
        return;
      }

      send(response, 201, {
        success: true,
        data: {
          request: {
            id: 'er-example-1',
            referenceNumber: 'EX-EM-00001',
            trackingToken: 'ex-tok-00001',
          },
          contact: '+254 700 000 111',
          consentVersion: '2026-10-01',
        },
      });
    });
    return;
  }

  if (url.pathname === '/public/emergency-requests/track' && request.method === 'POST') {
    // Tracking is keyed solely by the token the intake receipt issued. The stub
    // answers the live `trackPublic` shape (caller-safe status/copy, facility,
    // national numbers) so the tracker renders the API's words, not ours.
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'bad json' },
        });
        return;
      }

      if (typeof parsed.token !== 'string' || parsed.token.length === 0) {
        send(response, 400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'invalid', details: ['token'] },
        });
        return;
      }

      if (parsed.token !== 'ex-tok-00001') {
        send(response, 404, {
          success: false,
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'No request found for that tracking token',
          },
        });
        return;
      }

      send(response, 200, {
        success: true,
        data: {
          referenceNumber: 'EX-EM-00001',
          receivedAt: '2026-09-27T10:00:00.000Z',
          status: 'RECEIVED',
          statusLabel: 'Received',
          action: 'WAIT',
          message:
            'We have notified the facility. Keep this token to check again as your request advances.',
          level: 0,
          facility: {
            name: 'EXAMPLE General Hospital',
            slug: 'example-general-hospital',
            phone: '+254 700 000 111',
          },
          serviceArea: 'EXAMPLE metro',
          guidance: null,
          numbers: [
            { purpose: 'emergency', label: 'National emergency', phone: '+254 999', hours: '24/7' },
          ],
          numbersSource: 'seed',
          disclaimer: 'careOS does not dispatch emergency services or guarantee a response time.',
          consentVersion: '2026-10-01',
        },
      });
    });
    return;
  }

  if (url.pathname === '/auth/login' && request.method === 'POST') {
    // The live contract posts `LoginDto` (organizationId, email, password). The
    // stub validates as strictly as the API so a test that posts a malformed
    // body fails loudly instead of silently getting a session.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    if (
      typeof parsed.organizationId !== 'string' ||
      parsed.organizationId.length === 0 ||
      typeof parsed.email !== 'string' ||
      parsed.email.length === 0 ||
      typeof parsed.password !== 'string' ||
      parsed.password.length === 0
    ) {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'invalid' },
      });
      return;
    }

    if (parsed.email === MFA_EMAIL) {
      send(response, 200, {
        success: true,
        data: {
          mfaRequired: true,
          challengeToken: MFA_CHALLENGE_TOKEN,
          challengeExpiresIn: 300,
        },
      });
      return;
    }

    send(response, 200, {
      success: true,
      data: {
        mfaRequired: false,
        user: USER.user,
        session: SESSION,
        tokens: TOKENS,
      },
    });
    return;
  }

  if (url.pathname === '/auth/mfa/verify' && request.method === 'POST') {
    // Mirrors the live DTO: a challenge token plus one of { TOTP code, recovery
    // code }. A wrong challenge or wrong code is a 401, exactly as the API
    // answers, so the test proves the form shows the refusal without admitting
    // the session.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const recovery =
      typeof parsed.recoveryCode === 'string'
        ? parsed.recoveryCode.trim().toUpperCase().replace(/\s+/g, '')
        : '';
    if (
      parsed.challengeToken !== MFA_CHALLENGE_TOKEN ||
      (code !== MFA_CODE && recovery !== MFA_RECOVERY_CODE)
    ) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }

    send(response, 200, {
      success: true,
      data: {
        user: USER.user,
        session: SESSION,
        tokens: TOKENS,
      },
    });
    return;
  }

  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    // The proxy fills in the refresh token from the cookie; the browser can never
    // know it. The stub holds the proxy to account: the injected secret must be
    // the one we issued.
    let parsed;
    try {
      parsed = JSON.parse((await readBody(request)) || '{}');
    } catch {
      send(response, 400, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad json' },
      });
      return;
    }
    if (parsed.refreshToken !== TOKENS.refreshToken) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname === '/auth/me' && request.method === 'GET') {
    // A cookie the stub reads, not a header the app trusts: the application has no
    // idea this switch exists, and the 503 state is reached the way a real visitor
    // reaches it — the proxy forwards the session cookie as `Authorization: Bearer`,
    // and the stub answers by whether it recognises the token.
    const cookies = request.headers.cookie ?? '';

    // Reachable but broken. Distinct from signed-out so the gate can prove it tells
    // the two apart — telling someone to sign in when the API is down wastes a
    // support call and teaches people to ignore the message.
    if (cookies.includes('careos-e2e=unavailable')) {
      send(response, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
      return;
    }

    // Signed out means what it always did here: no usable session. The proxy turns
    // the `careos_session` cookie into this header, so its absence is the absence
    // of a session.
    if (request.headers.authorization !== `Bearer ${TOKENS.accessToken}`) {
      send(response, 401, { success: false, error: { code: 'UNAUTHORIZED' } });
      return;
    }

    send(response, 200, { success: true, data: USER });
    return;
  }


  if (url.pathname === '/patients' && request.method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let items = Object.values(PATIENT_REGISTRY);
    if (q) {
      items = items.filter(p => [p.patientNumber, `${p.firstName} ${p.otherNames||''} ${p.lastName}`, p.phone||''].join(' ').toLowerCase().includes(q));
    }
    send(response, 200, listEnvelope(items, 25));
    return;
  }

  if (url.pathname === '/patients' && request.method === 'POST') {
    let parsed;
    try { parsed = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR',message:'bad json'}}); return; }
    const body = parsed;
    if (!body.firstName || !body.lastName) {
      send(response,400,{success:false,error:{code:'VALIDATION_ERROR',message:'invalid'}}); return;
    }
    // trigger duplicate for the scripted walk-in: EXAMPLE, lastName Yusuf, DOB 1992-05-14
    if (body.firstName === 'EXAMPLE' && body.lastName === 'Yusuf' && body.dateOfBirth === '1992-05-14') {
      send(response,409,{success:false,error:{code:'POSSIBLE_DUPLICATE',details:{candidates:[{
        patientId:'pat_example_1002', patientNumber:'PAT-2026-000002', firstName:'EXAMPLE', lastName:'Yusuf', dateOfBirth:'1992-05-14', score:0.92, reasons:['name-match','dob-match']
      }]}}});
      return;
    }
    createdSeq++;
    const id = `pat_example_${1000+createdSeq}`;
    const num = `PAT-2026-${String(createdSeq).padStart(6,'0')}`;
    const created = { id, patientNumber:num, firstName:body.firstName, otherNames:body.otherNames||null, lastName:body.lastName, dateOfBirth:body.dateOfBirth||null, sex:body.sex||null, phone:body.phone||null, county:body.county||null, town:body.town||null, status:'ACTIVE', version:1 };
    PATIENT_REGISTRY[id] = created;
    send(response,201,{success:true,data:created});
    return;
  }

  if (url.pathname.startsWith('/patients/') && url.pathname.endsWith('/confirm-not-duplicate') && request.method === 'POST') {
    // id not needed for stub
    send(response,200,{success:true});
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+\/master$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const p = PATIENT_REGISTRY[id];
    if (!p) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    const sections = SECTIONS[id] || { guardians: [], consents: [], allergies: [], medicalHistory: [] };
    send(response, 200, { success: true, data: { patient: p, sections } });
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const p = PATIENT_REGISTRY[id];
    if (!p) { send(response,404,{success:false,error:{code:'RESOURCE_NOT_FOUND'}}); return; }
    const sections = SECTIONS[id] || { guardians:[], consents:[], allergies:[], medicalHistory:[] };
    send(response,200,{success:true,data:{ patient: p, sections }});
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+\/timeline$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const items = TIMELINE[id] || [];
    send(response, 200, listEnvelope(items, 25));
    return;
  }

  if (url.pathname.match(/^\/patients\/[^/]+\/access-log$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const items = ACCESS_LOG[id] || [];
    send(response, 200, listEnvelope(items, 25));
    return;
  }

  // F3 queue. Same contract and records as the MSW handlers.
  if (url.pathname === '/queue/metrics' && request.method === 'GET') {
    send(response, 200, { success: true, data: { stats: queueStats() } });
    return;
  }

  if (url.pathname === '/queue/status' && request.method === 'GET') {
    const mine = QUEUE.find((e) => e.status === 'WAITING' || e.status === 'CALLED');
    if (!mine) { send(response, 200, { success: true, data: { queued: false, ticketNumber: null, position: null, estimate: null } }); return; }
    const ahead = QUEUE.filter((e) => e.status === 'WAITING' && e.id !== mine.id).length;
    send(response, 200, { success: true, data: { queued: true, ticketNumber: mine.ticketNumber, position: ahead + 1, estimate: (ahead + 1) * 10 } });
    return;
  }

  if (url.pathname === '/queue' && request.method === 'GET') {
    const departmentId = url.searchParams.get('departmentId');
    const status = url.searchParams.get('status');
    let items = [...QUEUE];
    if (departmentId) items = items.filter((e) => e.departmentId === departmentId);
    if (status) items = items.filter((e) => e.status === status);
    items.sort((a, b) => Date.parse(b.enteredAt) - Date.parse(a.enteredAt));
    send(response, 200, listEnvelope(items, 25));
    return;
  }

  if (url.pathname === '/departments' && request.method === 'GET') {
    const items = DEPARTMENTS.map((d) => ({ ...d, branchId: QUEUE_BRANCH_ID }));
    send(response, 200, listEnvelope(items, 100));
    return;
  }

  if (url.pathname === '/queue/walk-ins/register' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (typeof body.patientId !== 'string' || typeof body.departmentId !== 'string') {
      send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return;
    }
    if (QUEUE.some((e) => e.patientId === body.patientId && QUEUE_ACTIVE.has(e.status))) {
      send(response,409,{success:false,error:{code:'VISIT_ALREADY_ACTIVE'}}); return;
    }
    const seq = ticketSeq++;
    const ticketNumber = `Q-${String(seq).padStart(3,'0')}`;
    const patient = PATIENT_REGISTRY[body.patientId];
    const entry = { id: `qe_example_${2000+seq}`, ticketNumber, patientId: body.patientId, patient: patient ? `${patient.firstName} ${patient.lastName}` : 'EXAMPLE Patient', visitId: `vis_example_${3000+seq}`, departmentId: body.departmentId, branchId: body.branchId || QUEUE_BRANCH_ID, status: 'WAITING', operationalPriority: body.priority || 'NORMAL', enteredAt: new Date().toISOString(), calledAt: null, serviceStartedAt: null, completedAt: null, note: body.note || null };
    QUEUE.push(entry);
    send(response, 201, { success: true, data: { id: entry.id, ticketNumber, visitId: entry.visitId, status: entry.status, position: QUEUE.filter((e) => e.status === 'WAITING').length } });
    return;
  }

  if (url.pathname.match(/^\/queue\/entries\/[^/]+\/status$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const entry = QUEUE.find((e) => e.id === id);
    if (!entry) { send(response,404,{success:false,error:{code:'RESOURCE_NOT_FOUND'}}); return; }
    let body;
    try { body = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (!(QUEUE_TRANSITIONS[entry.status] || []).includes(body.status)) {
      send(response,409,{success:false,error:{code:'INVALID_WORKFLOW_TRANSITION'}}); return;
    }
    const now = new Date().toISOString();
    entry.status = body.status;
    if (body.status === 'CALLED') entry.calledAt = now;
    if (body.status === 'IN_SERVICE') entry.serviceStartedAt = now;
    if (body.status === 'COMPLETED') entry.completedAt = now;
    if (body.status === 'WAITING') entry.calledAt = null;
    send(response, 200, { success: true, data: { ...entry } });
    return;
  }

  if (url.pathname.match(/^\/queue\/entries\/[^/]+\/priority$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-2,-1)[0];
    const entry = QUEUE.find((e) => e.id === id);
    if (!entry) { send(response,404,{success:false,error:{code:'RESOURCE_NOT_FOUND'}}); return; }
    let body;
    try { body = JSON.parse((await readBody(request))||'{}'); } catch { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (typeof body.operationalPriority !== 'string') { send(response,400,{success:false,error:{code:'VALIDATION_ERROR'}}); return; }
    if (!QUEUE_ACTIVE.has(entry.status)) { send(response,409,{success:false,error:{code:'INVALID_WORKFLOW_TRANSITION'}}); return; }
    entry.operationalPriority = body.operationalPriority;
    send(response, 200, { success: true, data: { ...entry } });
    return;
  }

  // F3 scheduling. Same contract and records as the MSW handlers.
  if (url.pathname === '/providers' && request.method === 'GET') {
    const departmentId = url.searchParams.get('departmentId');
    let items = PROVIDER_DIRECTORY.map((p) => ({ ...p }));
    if (departmentId) items = items.filter((p) => p.departmentIds.includes(departmentId));
    send(response, 200, listEnvelope(items));
    return;
  }

  if (url.pathname === '/schedules/slots' && request.method === 'GET') {
    const providerId = url.searchParams.get('providerId') || '';
    const departmentId = url.searchParams.get('departmentId') || '';
    const date = url.searchParams.get('date') || todayISO();
    send(response, 200, { success: true, data: { date: utcDayStart(date).toISOString(), slots: generateSlots(providerId, departmentId, date) } });
    return;
  }

  if (url.pathname === '/appointments/waitlist/entries' && request.method === 'GET') {
    const departmentId = url.searchParams.get('departmentId');
    const status = url.searchParams.get('status');
    let items = [...LIVE_WAITLIST];
    if (departmentId) items = items.filter((e) => e.departmentId === departmentId);
    if (status) items = items.filter((e) => e.status === status);
    send(response, 200, listEnvelope(items));
    return;
  }

  if (url.pathname === '/appointments/waitlist/entries' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.patientId !== 'string' || typeof body.departmentId !== 'string') {
      send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
    }
    if (LIVE_WAITLIST.some((e) => e.patientId === body.patientId && e.departmentId === body.departmentId && ACTIONABLE_WAITLIST.has(e.status))) {
      send(response, 409, { success: false, error: { code: 'WAITLIST_DUPLICATE' } }); return;
    }
    const seq = waitlistSeq++;
    const now = new Date().toISOString();
    const entry = { id: `wl_example_${5000 + seq}`, branchId: body.branchId || SCHEDULING_BRANCH_ID, departmentId: body.departmentId, patientId: body.patientId, providerId: body.providerId || null, status: 'WAITING', offeredAt: null, offerExpiresAt: null, offeredStartAt: null, acceptedAppointmentId: null, resolvedAt: null, preferredDate: body.preferredDate || null, notes: body.notes || null, createdAt: now, updatedAt: now };
    LIVE_WAITLIST.push(entry);
    send(response, 201, { success: true, data: { entry } });
    return;
  }

  if (url.pathname.match(/^\/appointments\/waitlist\/entries\/[^/]+\/accept$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const entry = LIVE_WAITLIST.find((e) => e.id === id);
    if (!entry) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (entry.status !== 'OFFERED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    const now = new Date().toISOString();
    const startsAt = entry.offeredStartAt || now;
    const seq = appointmentSeq++;
    const appointment = { id: `apt_example_${4000 + seq}`, organizationId: 'org_example_0001', branchId: entry.branchId, departmentId: entry.departmentId, patientId: entry.patientId, providerId: entry.providerId || 'usr_example_9101', startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60000).toISOString(), mode: 'IN_PERSON', appointmentType: null, reason: 'Accepted from waitlist.', status: 'BOOKED', version: 1, checkedInAt: null, inProgressAt: null, completedAt: null, noShowAt: null, cancelledAt: null, cancelReason: null, rescheduledFromId: null, rescheduledToId: null, rescheduledAt: null, createdAt: now, updatedAt: now };
    APPOINTMENTS.push(appointment);
    entry.status = 'ACCEPTED'; entry.resolvedAt = now; entry.acceptedAppointmentId = appointment.id; entry.updatedAt = now;
    send(response, 201, { success: true, data: { appointment } });
    return;
  }

  if (url.pathname.match(/^\/appointments\/waitlist\/entries\/[^/]+\/decline$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const entry = LIVE_WAITLIST.find((e) => e.id === id);
    if (!entry) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    entry.status = 'DECLINED'; entry.resolvedAt = new Date().toISOString();
    send(response, 201, { success: true, data: { declined: true } });
    return;
  }

  if (url.pathname.match(/^\/appointments\/waitlist\/entries\/[^/]+\/leave$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const index = LIVE_WAITLIST.findIndex((e) => e.id === id);
    if (index === -1) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    const [entry] = LIVE_WAITLIST.splice(index, 1);
    send(response, 201, { success: true, data: { entry: { ...entry, status: 'REMOVED' } } });
    return;
  }

  if (url.pathname === '/appointments' && request.method === 'GET') {
    const departmentId = url.searchParams.get('departmentId');
    const providerId = url.searchParams.get('providerId');
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    let items = [...APPOINTMENTS];
    if (departmentId) items = items.filter((a) => a.departmentId === departmentId);
    if (providerId) items = items.filter((a) => a.providerId === providerId);
    if (patientId) items = items.filter((a) => a.patientId === patientId);
    if (status) items = items.filter((a) => a.status === status);
    if (dateFrom) items = items.filter((a) => a.startsAt >= dateFrom);
    if (dateTo) items = items.filter((a) => a.startsAt <= dateTo);
    items.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    send(response, 200, listEnvelope(items));
    return;
  }

  if (url.pathname === '/appointments' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.patientId !== 'string' || typeof body.providerId !== 'string' || typeof body.departmentId !== 'string' || typeof body.startsAt !== 'string' || typeof body.mode !== 'string') {
      send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
    }
    const startsAt = new Date(body.startsAt).toISOString();
    const slot = generateSlots(body.providerId, body.departmentId, businessDayKey(startsAt)).find((s) => s.startsAt === startsAt);
    if (!slot || slot.remaining <= 0) { send(response, 409, { success: false, error: { code: 'APPOINTMENT_CONFLICT' } }); return; }
    const seq = appointmentSeq++;
    const now = new Date().toISOString();
    const appointment = { id: `apt_example_${4000 + seq}`, organizationId: 'org_example_0001', branchId: body.branchId || SCHEDULING_BRANCH_ID, departmentId: body.departmentId, patientId: body.patientId, providerId: body.providerId, startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60000).toISOString(), mode: body.mode, appointmentType: body.appointmentType || null, reason: body.reason || null, status: 'BOOKED', version: 1, checkedInAt: null, inProgressAt: null, completedAt: null, noShowAt: null, cancelledAt: null, cancelReason: null, rescheduledFromId: null, rescheduledToId: null, rescheduledAt: null, createdAt: now, updatedAt: now };
    APPOINTMENTS.push(appointment);
    send(response, 201, { success: true, data: { appointment } });
    return;
  }

  if (url.pathname.match(/^\/appointments\/[^/]+\/status$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const appointment = APPOINTMENTS.find((a) => a.id === id);
    if (!appointment) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (!(APPOINTMENT_TRANSITIONS[appointment.status] || []).includes(body.status)) {
      send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return;
    }
    const now = new Date().toISOString();
    appointment.status = body.status;
    if (body.status === 'CHECKED_IN') appointment.checkedInAt = now;
    if (body.status === 'IN_PROGRESS') appointment.inProgressAt = now;
    if (body.status === 'COMPLETED') appointment.completedAt = now;
    if (body.status === 'NO_SHOW') appointment.noShowAt = now;
    if (body.status === 'CANCELLED') { appointment.cancelledAt = now; appointment.cancelReason = body.reason || null; }
    appointment.version += 1; appointment.updatedAt = now;
    send(response, 200, { success: true, data: { appointment } });
    return;
  }

  if (url.pathname.match(/^\/appointments\/[^/]+\/cancel$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const appointment = APPOINTMENTS.find((a) => a.id === id);
    if (!appointment) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    const now = new Date().toISOString();
    appointment.status = 'CANCELLED'; appointment.cancelledAt = now; appointment.cancelReason = body.reason || null;
    appointment.version += 1; appointment.updatedAt = now;
    send(response, 201, { success: true, data: { appointment } });
    return;
  }

  if (url.pathname.match(/^\/appointments\/[^/]+\/reschedule$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const original = APPOINTMENTS.find((a) => a.id === id);
    if (!original) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'].includes(original.status)) {
      send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return;
    }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    if (typeof body.startsAt !== 'string') { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const startsAt = new Date(body.startsAt).toISOString();
    const seq = appointmentSeq++;
    const now = new Date().toISOString();
    const replacement = { ...original, id: `apt_example_${4000 + seq}`, startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60000).toISOString(), status: 'BOOKED', version: 1, checkedInAt: null, inProgressAt: null, completedAt: null, noShowAt: null, cancelledAt: null, cancelReason: null, rescheduledFromId: original.id, rescheduledToId: null, rescheduledAt: null, createdAt: now, updatedAt: now };
    original.status = 'RESCHEDULED'; original.rescheduledToId = replacement.id; original.rescheduledAt = now; original.version += 1; original.updatedAt = now;
    APPOINTMENTS.push(replacement);
    send(response, 201, { success: true, data: { appointment: replacement, superseded: original } });
    return;
  }

  // --- vitals (nursing) ---------------------------------------------------
  if (url.pathname === '/vitals' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const visitId = url.searchParams.get('visitId');
    let items = [...VITALS];
    if (patientId) items = items.filter((v) => v.patientId === patientId);
    if (visitId) items = items.filter((v) => v.visitId === visitId);
    items.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    send(response, 200, listEnvelope(items.map(serializeVital)));
    return;
  }

  if (url.pathname === '/vitals' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.patientId !== 'string' || !hasVitalContent(body)) { send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const observedAt = typeof body.observedAt === 'string' && body.observedAt.length > 0 ? new Date(body.observedAt).toISOString() : new Date().toISOString();
    const now = new Date().toISOString();
    const record = { id: `vr_example_${vitalSeq++}`, patientId: body.patientId, visitId: typeof body.visitId === 'string' && body.visitId.length > 0 ? body.visitId : null, ...measurementsOf(body), notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null, observedAt, correctionOfId: null, correctionReason: null, recordedByUserId: 'usr_example_0001', createdAt: now };
    VITALS.push(record);
    send(response, 201, { success: true, data: { vitalRecord: serializeVital(record) } });
    return;
  }

  if (url.pathname.match(/^\/vitals\/[^/]+\/correct$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const original = VITALS.find((v) => v.id === id);
    if (!original) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    const reason = typeof body.correctionReason === 'string' ? body.correctionReason.trim() : '';
    if (reason.length === 0 || !hasVitalContent(body)) { send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const now = new Date().toISOString();
    const record = { id: `vr_example_${vitalSeq++}`, patientId: original.patientId, visitId: original.visitId, ...measurementsOf(body), notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null, observedAt: original.observedAt, correctionOfId: original.id, correctionReason: reason, recordedByUserId: 'usr_example_0001', createdAt: now };
    VITALS.push(record);
    send(response, 201, { success: true, data: { vitalRecord: serializeVital(record) } });
    return;
  }

  // --- schedule templates (admin) ----------------------------------------
  if (url.pathname === '/schedules/templates' && request.method === 'GET') {
    const providerId = url.searchParams.get('providerId');
    const departmentId = url.searchParams.get('departmentId');
    const dayOfWeek = url.searchParams.get('dayOfWeek');
    let items = [...SCHEDULE_TEMPLATES];
    if (providerId) items = items.filter((t) => t.providerId === providerId);
    if (departmentId) items = items.filter((t) => t.departmentId === departmentId);
    if (dayOfWeek !== null) items = items.filter((t) => t.dayOfWeek === Number(dayOfWeek));
    items.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinutes - b.startMinutes);
    send(response, 200, listEnvelope(items));
    return;
  }

  if (url.pathname === '/schedules/templates' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.providerId !== 'string' || typeof body.departmentId !== 'string') { send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const schedule = { id: `sch_example_${templateSeq++}`, providerId: body.providerId, branchId: body.branchId || SCHEDULING_BRANCH_ID, departmentId: body.departmentId, dayOfWeek: typeof body.dayOfWeek === 'number' ? body.dayOfWeek : 0, startMinutes: typeof body.startMinutes === 'number' ? body.startMinutes : 480, endMinutes: typeof body.endMinutes === 'number' ? body.endMinutes : 780, slotDurationMinutes: typeof body.slotDurationMinutes === 'number' ? body.slotDurationMinutes : 30, capacity: typeof body.capacity === 'number' ? body.capacity : 1, isAvailable: typeof body.isAvailable === 'boolean' ? body.isAvailable : true, note: typeof body.note === 'string' && body.note.length > 0 ? body.note : null };
    SCHEDULE_TEMPLATES.push(schedule);
    send(response, 201, { success: true, data: { schedule } });
    return;
  }

  if (url.pathname.match(/^\/schedules\/templates\/[^/]+$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-1)[0];
    const template = SCHEDULE_TEMPLATES.find((t) => t.id === id);
    if (!template) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    for (const key of ['dayOfWeek', 'startMinutes', 'endMinutes', 'slotDurationMinutes', 'capacity']) if (typeof body[key] === 'number') template[key] = body[key];
    if (typeof body.isAvailable === 'boolean') template.isAvailable = body.isAvailable;
    if (typeof body.note === 'string' && body.note.length > 0) template.note = body.note;
    send(response, 200, { success: true, data: { schedule: template } });
    return;
  }

  if (url.pathname.match(/^\/schedules\/templates\/[^/]+$/) && request.method === 'DELETE') {
    const id = url.pathname.split('/').slice(-1)[0];
    const index = SCHEDULE_TEMPLATES.findIndex((t) => t.id === id);
    if (index < 0) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    SCHEDULE_TEMPLATES.splice(index, 1);
    send(response, 204, undefined);
    return;
  }

  // --- schedule overrides (admin) ----------------------------------------
  if (url.pathname === '/schedules/overrides' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.providerId !== 'string' || typeof body.date !== 'string') { send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (LIVE_OVERRIDES.some((o) => o.providerId === body.providerId && o.date === body.date)) { send(response, 409, { success: false, error: { code: 'CONFLICT' } }); return; }
    const override = { id: `ovr_example_${overrideSeq++}`, providerId: body.providerId, branchId: body.branchId || SCHEDULING_BRANCH_ID, departmentId: typeof body.departmentId === 'string' ? body.departmentId : '', date: body.date, type: typeof body.type === 'string' ? body.type : 'BLOCKED', startMinutes: typeof body.startMinutes === 'number' ? body.startMinutes : null, endMinutes: typeof body.endMinutes === 'number' ? body.endMinutes : null, slotDurationMinutes: typeof body.slotDurationMinutes === 'number' ? body.slotDurationMinutes : null, capacity: typeof body.capacity === 'number' ? body.capacity : null, note: typeof body.note === 'string' && body.note.length > 0 ? body.note : null };
    LIVE_OVERRIDES.push(override);
    send(response, 201, { success: true, data: { override } });
    return;
  }

  if (url.pathname.match(/^\/schedules\/overrides\/[^/]+$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-1)[0];
    const override = LIVE_OVERRIDES.find((o) => o.id === id);
    if (!override) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    if (typeof body.type === 'string') override.type = body.type;
    for (const key of ['startMinutes', 'endMinutes', 'slotDurationMinutes', 'capacity']) if (typeof body[key] === 'number' || body[key] === null) override[key] = body[key];
    if (typeof body.note === 'string') override.note = body.note;
    send(response, 200, { success: true, data: { override } });
    return;
  }

  if (url.pathname.match(/^\/schedules\/overrides\/[^/]+$/) && request.method === 'DELETE') {
    const id = url.pathname.split('/').slice(-1)[0];
    const index = LIVE_OVERRIDES.findIndex((o) => o.id === id);
    if (index < 0) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    LIVE_OVERRIDES.splice(index, 1);
    send(response, 204, undefined);
    return;
  }

// --- encounters (F4 doctor workspace) ---------------------------------
  if (url.pathname === '/encounters' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const departmentId = url.searchParams.get('departmentId');
    const providerId = url.searchParams.get('providerId');
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    let items = [...ENCOUNTERS];
    if (patientId) items = items.filter((e) => e.patientId === patientId);
    if (departmentId) items = items.filter((e) => e.departmentId === departmentId);
    if (providerId) items = items.filter((e) => e.providerId === providerId);
    if (type) items = items.filter((e) => e.type === type);
    if (status) items = items.filter((e) => e.status === status);
    items.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
    send(response, 200, listEnvelope(items, 50));
    return;
  }

  if (url.pathname.match(/^\/encounters\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const encounter = ENCOUNTERS.find((e) => e.id === id);
    if (!encounter) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { encounter: { ...encounter } } });
    return;
  }

  if (url.pathname.match(/^\/encounters\/[^/]+\/status$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const encounter = ENCOUNTERS.find((e) => e.id === id);
    if (!encounter) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.status !== 'string' || body.status.length === 0) {
      send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
    }
    const next = body.status;
    if (!(ENCOUNTER_TRANSITIONS[encounter.status] || []).includes(next)) {
      send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return;
    }
    const now = new Date().toISOString();
    encounter.status = next;
    encounter.version += 1;
    encounter.updatedAt = now;
    if (next === 'COMPLETED') encounter.completedAt = now;
    else encounter.inProgressAt = now;
    send(response, 200, { success: true, data: { encounter: { ...encounter } } });
    return;
  }

  // --- clinical notes (F4 doctor workspace) -----------------------------
  // The templates route is registered before the {id} route: both are one
  // segment under /clinical-notes, so ordering is what disambiguates them.
  if (url.pathname === '/clinical-notes/templates' && request.method === 'GET') {
    const departmentId = url.searchParams.get('departmentId');
    let items = LIVE_NOTE_TEMPLATES;
    if (departmentId) items = items.filter((t) => t.departmentId === departmentId);
    send(response, 200, listEnvelope(items, 100));
    return;
  }

  if (url.pathname === '/clinical-notes' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const encounterId = url.searchParams.get('encounterId');
    const status = url.searchParams.get('status');
    let items = [...LIVE_NOTES];
    if (patientId) items = items.filter((n) => n.patientId === patientId);
    if (encounterId) items = items.filter((n) => n.encounterId === encounterId);
    if (status) items = items.filter((n) => n.status === status);
    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    send(response, 200, listEnvelope(items.map(serializeNote), 50));
    return;
  }

  if (url.pathname === '/clinical-notes' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.encounterId !== 'string') { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const encounter = ENCOUNTERS.find((e) => e.id === body.encounterId);
    if (!encounter) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (encounter.status === 'COMPLETED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let sections = null;
    if (body.sections !== undefined) sections = validateNoteSections(body.sections);
    else if (typeof body.templateId === 'string') {
      const template = LIVE_NOTE_TEMPLATES.find((t) => t.id === body.templateId);
      if (template) { sections = {}; for (const key of template.sections) sections[key] = ''; }
    }
    if (!sections || Object.keys(sections).length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const now = new Date().toISOString();
    const note = { id: `cn_example_${8000 + LIVE_NOTES.length + 1}`, organizationId: 'org_example_0001', patientId: encounter.patientId, encounterId: body.encounterId, authorId: 'usr_example_9001', status: 'DRAFT', title: typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null, sections, reason: null, templateId: typeof body.templateId === 'string' ? body.templateId : null, finalizedAt: null, createdAt: now, updatedAt: now, _versions: [] };
    LIVE_NOTES.push(note);
    send(response, 201, { success: true, data: { note: serializeNote(note) } });
    return;
  }

  if (url.pathname.match(/^\/clinical-notes\/[^/]+\/finalize$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const note = LIVE_NOTES.find((n) => n.id === id);
    if (!note) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (note.status !== 'DRAFT') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    const now = new Date().toISOString();
    note.status = 'FINAL'; note.finalizedAt = now; note.updatedAt = now;
    note._versions.push({ id: `cnv_example_${noteVersionSeq++}`, versionNumber: 1, kind: 'ORIGINAL', title: note.title, sections: { ...note.sections }, reason: null, authorId: note.authorId, createdAt: now });
    send(response, 201, { success: true, data: { note: serializeNote(note) } });
    return;
  }

  if (url.pathname.match(/^\/clinical-notes\/[^/]+\/amend$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const note = LIVE_NOTES.find((n) => n.id === id);
    if (!note) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (note.status !== 'FINAL') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.reason !== 'string' || body.reason.trim().length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const sections = validateNoteSections(body.sections);
    if (!sections) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const lastVersion = note._versions[note._versions.length - 1];
    const versionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;
    const now = new Date().toISOString();
    note.sections = sections; note.title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : note.title; note.reason = body.reason.trim(); note.updatedAt = now;
    note._versions.push({ id: `cnv_example_${noteVersionSeq++}`, versionNumber, kind: 'AMENDMENT', title: note.title, sections: { ...sections }, reason: body.reason.trim(), authorId: note.authorId, createdAt: now });
    send(response, 201, { success: true, data: { note: serializeNote(note) } });
    return;
  }

  if (url.pathname.match(/^\/clinical-notes\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const note = LIVE_NOTES.find((n) => n.id === id);
    if (!note) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { note: serializeNoteWithVersions(note) } });
    return;
  }

  if (url.pathname.match(/^\/clinical-notes\/[^/]+$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/').slice(-1)[0];
    const note = LIVE_NOTES.find((n) => n.id === id);
    if (!note) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (note.status !== 'DRAFT') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (body.title !== undefined) note.title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null;
    if (body.sections !== undefined) {
      const sections = validateNoteSections(body.sections);
      if (!sections) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
      note.sections = sections;
    }
    note.updatedAt = new Date().toISOString();
    send(response, 200, { success: true, data: { note: serializeNote(note) } });
    return;
  }

  // --- medications (F4 doctor workspace) ----------------------------------
  if (url.pathname === '/medications' && request.method === 'GET') {
    const category = url.searchParams.get('category');
    const isActive = url.searchParams.get('isActive');
    const isControlled = url.searchParams.get('isControlled');
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
    let items = [...LIVE_MEDICATIONS];
    if (category) items = items.filter((m) => m.category === category);
    if (isActive) items = items.filter((m) => m.isActive === (isActive === 'true'));
    if (isControlled) items = items.filter((m) => m.isControlled === (isControlled === 'true'));
    if (search) items = items.filter((m) => `${m.name} ${m.genericName ?? ''}`.toLowerCase().includes(search));
    send(response, 200, listEnvelope(items, 100));
    return;
  }

  if (url.pathname.match(/^\/medications\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const medication = LIVE_MEDICATIONS.find((m) => m.id === id);
    if (!medication) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { medication: { ...medication } } });
    return;
  }

  // --- prescriptions (F4 doctor workspace) --------------------------------
  if (url.pathname === '/prescriptions' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const branchId = url.searchParams.get('branchId');
    const providerId = url.searchParams.get('providerId');
    const status = url.searchParams.get('status');
    let items = [...LIVE_PRESCRIPTIONS];
    if (patientId) items = items.filter((p) => p.patientId === patientId);
    if (branchId) items = items.filter((p) => p.branchId === branchId);
    if (providerId) items = items.filter((p) => p.providerId === providerId);
    if (status) items = items.filter((p) => p.status === status);
    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    send(response, 200, listEnvelope(items.map(serializePrescription), 50));
    return;
  }

  if (url.pathname === '/prescriptions' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.patientId !== 'string' || !PATIENT_REGISTRY[body.patientId]) {
      send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return;
    }
    const items = validatePrescriptionItems(body.items);
    if (!items) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const now = new Date().toISOString();
    const prescription = { id: `prx_example_${7000 + LIVE_PRESCRIPTIONS.length + 1}`, organizationId: 'org_example_0001', branchId: 'br_example_0001', patientId: body.patientId, providerId: 'usr_example_9001', status: 'DRAFT', notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null, issuedById: null, issuedAt: null, dispensedAt: null, cancelledById: null, cancelledAt: null, cancelReason: null, version: 1, createdAt: now, _items: items };
    LIVE_PRESCRIPTIONS.push(prescription);
    send(response, 201, { success: true, data: { prescription: serializePrescription(prescription) } });
    return;
  }

  if (url.pathname.match(/^\/prescriptions\/[^/]+\/action$/) && request.method === 'POST') {
    const id = url.pathname.split('/').slice(-2, -1)[0];
    const prescription = LIVE_PRESCRIPTIONS.find((p) => p.id === id);
    if (!prescription) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const action = body.action;
    if (action !== 'issue' && action !== 'cancel') { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const allowed = PRESCRIPTION_ACTIONS_BY_STATUS[prescription.status];
    if (!allowed.includes(action)) {
      send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return;
    }
    const now = new Date().toISOString();
    prescription.version += 1;
    if (action === 'issue') {
      prescription.status = 'ISSUED';
      prescription.issuedById = 'usr_example_9001';
      prescription.issuedAt = now;
    } else {
      prescription.status = 'CANCELLED';
      prescription.cancelledById = 'usr_example_9001';
      prescription.cancelledAt = now;
      prescription.cancelReason = typeof body.cancelReason === 'string' && body.cancelReason.trim().length > 0 ? body.cancelReason.trim() : null;
    }
    send(response, 201, { success: true, data: { prescription: serializePrescription(prescription) } });
    return;
  }

  if (url.pathname.match(/^\/prescriptions\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const prescription = LIVE_PRESCRIPTIONS.find((p) => p.id === id);
    if (!prescription) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { prescription: serializePrescription(prescription) } });
    return;
  }

  // --- pharmacy inventory (F6 dispense worklist) ---------------------------
  if (url.pathname === '/pharmacy/stock/on-hand' && request.method === 'GET') {
    const branchId = url.searchParams.get('branchId');
    const onHand = [...LIVE_STOCK]
      .map(([medicationId, quantity]) => {
        const medication = LIVE_MEDICATIONS.find((m) => m.id === medicationId);
        return { medicationId, name: medication ? medication.name : null, unit: medication ? medication.unit : null, branchId: INVENTORY_BRANCH_ID, quantity };
      })
      .filter((row) => !branchId || row.branchId === branchId);
    send(response, 200, { success: true, data: { onHand } });
    return;
  }

  if (url.pathname === '/pharmacy/stock/alerts' && request.method === 'GET') {
    const branchId = url.searchParams.get('branchId');
    const alerts = !branchId || branchId === INVENTORY_BRANCH_ID ? serializeInventoryAlerts() : [];
    send(response, 200, { success: true, data: { alerts } });
    return;
  }

  if (url.pathname === '/pharmacy/stock/receive' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const lines = Array.isArray(body.lines) ? body.lines : null;
    if (typeof body.branchId !== 'string' || !lines || lines.length === 0) {
      send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
    }
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (typeof line.medicationId !== 'string' || typeof line.batchNumber !== 'string' || line.batchNumber.trim().length === 0 || !Number.isInteger(quantity) || quantity <= 0) {
        send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
      }
      if (!LIVE_MEDICATIONS.find((m) => m.id === line.medicationId)) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    }
    const batches = lines.map((line) => {
      const quantity = Number(line.quantity);
      const batchNumber = line.batchNumber.trim();
      LIVE_STOCK.set(line.medicationId, (LIVE_STOCK.get(line.medicationId) || 0) + quantity);
      if (typeof line.expiryDate === 'string' && line.expiryDate.length > 0) {
        const days = Math.ceil((Date.parse(line.expiryDate) - Date.now()) / 86400000);
        if (!Number.isNaN(days)) LIVE_EXPIRY_DAYS.set(line.medicationId, days);
      }
      return { id: inventoryBatchIdFor(body.branchId, line.medicationId, batchNumber), batchNumber, medicationId: line.medicationId, quantity };
    });
    send(response, 201, { success: true, data: { batches } });
    return;
  }

  if (url.pathname === '/pharmacy/stock/write-off' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const lines = Array.isArray(body.lines) ? body.lines : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (typeof body.branchId !== 'string' || reason.length === 0 || reason.length > 500 || !lines || lines.length === 0) {
      send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
    }
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (typeof line.medicationId !== 'string' || !Number.isInteger(quantity) || quantity <= 0) {
        send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
      }
      if (!LIVE_MEDICATIONS.find((m) => m.id === line.medicationId)) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
      if ((LIVE_STOCK.get(line.medicationId) || 0) < quantity) { send(response, 409, { success: false, error: { code: 'INSUFFICIENT_STOCK' } }); return; }
    }
    let totalQuantity = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      LIVE_STOCK.set(line.medicationId, (LIVE_STOCK.get(line.medicationId) || 0) - quantity);
      totalQuantity += quantity;
    }
    send(response, 201, { success: true, data: { writeOffId: `wro_example_${inventoryWriteOffSeq++}`, branchId: body.branchId, quantity: totalQuantity } });
    return;
  }

  if (url.pathname === '/pharmacy/stock/dispense' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const lines = Array.isArray(body.lines) ? body.lines : null;
    if (typeof body.prescriptionId !== 'string' || typeof body.branchId !== 'string' || !lines || lines.length === 0) {
      send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return;
    }
    const prescription = LIVE_PRESCRIPTIONS.find((p) => p.id === body.prescriptionId);
    if (!prescription) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (prescription.status !== 'ISSUED' && prescription.status !== 'PARTIALLY_DISPENSED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    if (prescription.branchId !== body.branchId) { send(response, 409, { success: false, error: { code: 'INSUFFICIENT_STOCK' } }); return; }
    for (const line of lines) {
      const item = prescription._items.find((it) => it.medicationId === line.medicationId);
      if (!item) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > item.quantity - item.dispensedQuantity) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
      if ((LIVE_STOCK.get(line.medicationId) || 0) < quantity) { send(response, 409, { success: false, error: { code: 'INSUFFICIENT_STOCK' } }); return; }
    }
    for (const line of lines) {
      const quantity = Number(line.quantity);
      LIVE_STOCK.set(line.medicationId, (LIVE_STOCK.get(line.medicationId) || 0) - quantity);
      prescription._items.find((it) => it.medicationId === line.medicationId).dispensedQuantity += quantity;
    }
    const totalRequested = prescription._items.reduce((sum, item) => sum + item.quantity, 0);
    const totalDispensed = prescription._items.reduce((sum, item) => sum + item.dispensedQuantity, 0);
    const next = totalDispensed >= totalRequested ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
    prescription.status = next;
    prescription.version += 1;
    if (next === 'DISPENSED') prescription.dispensedAt = new Date().toISOString();
    send(response, 201, { success: true, data: { prescriptionStatus: next, dispensedLines: lines.map((line) => line.medicationId) } });
    return;
  }

  if (url.pathname.match(/^\/prescriptions\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const prescription = LIVE_PRESCRIPTIONS.find((p) => p.id === id);
    if (!prescription) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { prescription: serializePrescription(prescription) } });
    return;
  }

  // --- billing (F7 invoices desk) -----------------------------------------
  if (url.pathname === '/invoices' && request.method === 'GET') {
    const branchId = url.searchParams.get('branchId');
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20') || 20));
    const filtered = LIVE_INVOICES.filter((invoice) =>
      (!branchId || invoice.branchId === branchId) &&
      (!patientId || invoice.patientId === patientId) &&
      (!status || invoice.status === status));
    const start = (page - 1) * limit;
    const rows = filtered.slice(start, start + limit).map(billingListRow);
    send(response, 200, { success: true, data: rows, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }

  const invoiceAction = url.pathname.match(/^\/invoices\/([^/]+)\/(issue|cancel|refund)$/);
  if (invoiceAction && request.method === 'POST') {
    const [, id, action] = invoiceAction;
    const invoice = billingFind(id);
    if (!invoice) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    const reason = typeof body.reason === 'string' && body.reason.length > 0 ? body.reason : null;
    const now = new Date().toISOString();
    if (action === 'issue') {
      if (invoice.status !== 'DRAFT') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      invoice.status = 'ISSUED'; invoice.issuedAt = now; invoice.version += 1;
    } else if (action === 'cancel') {
      if (invoice.status !== 'DRAFT' && invoice.status !== 'ISSUED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      invoice.status = 'CANCELLED'; invoice.cancelledAt = now; invoice.cancelReason = reason; invoice.version += 1;
    } else {
      if (invoice.status !== 'PAID') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      for (const payment of invoice.payments) {
        if (payment.status !== 'COMPLETED') continue;
        payment.status = 'REFUNDED'; payment.refundedAt = now; payment.refundReason = reason || 'Invoice refunded';
      }
      invoice.status = 'REFUNDED'; invoice.balanceDue = invoice.total; invoice.refundedAt = now; invoice.refundReason = reason; invoice.version += 1;
    }
    send(response, 200, { success: true, data: { invoice } });
    return;
  }

  const invoicePayments = url.pathname.match(/^\/invoices\/([^/]+)\/payments$/);
  if (invoicePayments && request.method === 'POST') {
    const invoice = billingFind(invoicePayments[1]);
    if (!invoice) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const amount = typeof body.amount === 'string' ? body.amount : null;
    const method = typeof body.method === 'string' ? body.method : null;
    if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || billingCents(amount) <= 0 || !method) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (billingCents(amount) > billingCents(invoice.balanceDue)) { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    const payment = billingPayment(`pay_example_${billingPaymentSeq++}`, `RCP-2026-${String(billingReceiptSeq++).padStart(6, '0')}`, amount, method, 'COMPLETED', new Date().toISOString(), { externalReference: typeof body.externalReference === 'string' ? body.externalReference : null, note: typeof body.note === 'string' ? body.note : null });
    payment.invoiceId = invoice.id; payment.patientId = invoice.patientId;
    invoice.payments.push(payment);
    invoice.balanceDue = billingFromCents(billingCents(invoice.balanceDue) - billingCents(amount));
    invoice.status = billingCents(invoice.balanceDue) === 0 ? 'PAID' : 'PARTIALLY_PAID';
    invoice.version += 1;
    send(response, 201, { success: true, data: { payment } });
    return;
  }

  const invoicePaymentsList = url.pathname.match(/^\/invoices\/([^/]+)\/payments$/);
  if (invoicePaymentsList && request.method === 'GET') {
    const invoice = billingFind(invoicePaymentsList[1]);
    if (!invoice) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, listEnvelope(invoice.payments));
    return;
  }

  const invoiceOne = url.pathname.match(/^\/invoices\/([^/]+)$/);
  if (invoiceOne && request.method === 'GET') {
    const invoice = billingFind(invoiceOne[1]);
    if (!invoice) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { invoice } });
    return;
  }

  const paymentRefund = url.pathname.match(/^\/payments\/([^/]+)\/refund$/);
  if (paymentRefund && request.method === 'POST') {
    const id = paymentRefund[1];
    let found = null;
    let invoice = null;
    for (const candidate of LIVE_INVOICES) {
      const payment = candidate.payments.find((row) => row.id === id);
      if (payment) { found = payment; invoice = candidate; break; }
    }
    if (!found || !invoice) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    if (found.status !== 'COMPLETED') { send(response, 409, { success: false, error: { code: 'PAYMENT_ALREADY_PROCESSED' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    const now = new Date().toISOString();
    found.status = 'REFUNDED'; found.refundedAt = now; found.refundReason = typeof body.reason === 'string' && body.reason.length > 0 ? body.reason : null;
    invoice.balanceDue = billingFromCents(billingCents(invoice.balanceDue) + billingCents(found.amount));
    invoice.status = billingCents(invoice.balanceDue) === 0 ? 'PAID' : 'PARTIALLY_PAID';
    invoice.version += 1;
    send(response, 200, { success: true, data: { payment: found } });
    return;
  }

  // --- insurance (F7 claims desk) ----------------------------------------
  if (url.pathname === '/insurance/payers' && request.method === 'GET') {
    send(response, 200, listEnvelope(LIVE_PAYERS.map((payer) => ({ ...payer }))));
    return;
  }

  if (url.pathname === '/insurance/payers' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const name = typeof body.name === 'string' && body.name.length > 0 ? body.name : null;
    if (!name) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A payer name is required.' } }); return; }
    if (LIVE_PAYERS.some((payer) => payer.name === name)) { send(response, 409, { success: false, error: { code: 'CONFLICT', message: 'A payer with this name already exists.' } }); return; }
    const now = new Date().toISOString();
    const payer = insurancePayer(`payer_example_${6000 + payerSeq}`, name, typeof body.contactPhone === 'string' && body.contactPhone.length > 0 ? body.contactPhone : null, typeof body.email === 'string' && body.email.length > 0 ? body.email : null);
    payer.isActive = body.isActive === false ? false : true; payer.createdAt = now; payer.updatedAt = now;
    payerSeq += 1;
    LIVE_PAYERS.push(payer);
    send(response, 201, { success: true, data: { payer } });
    return;
  }

  if (url.pathname === '/insurance/policies' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const payerId = url.searchParams.get('payerId');
    const items = LIVE_POLICIES.filter((policy) =>
      (!patientId || policy.patientId === patientId) &&
      (!payerId || policy.payerId === payerId));
    send(response, 200, listEnvelope(items.map((policy) => ({ ...policy }))));
    return;
  }

  if (url.pathname === '/insurance/policies' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const payer = LIVE_PAYERS.find((row) => row.id === body.payerId && row.isActive);
    if (!payer) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Payer not found' } }); return; }
    if (typeof body.patientId !== 'string' || typeof body.policyNumber !== 'string' || body.policyNumber.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid policy.' } }); return; }
    const coverageType = body.coverageType === 'FULL' ? 'FULL' : 'PARTIAL';
    if (coverageType === 'PARTIAL' && typeof body.coveragePercent !== 'number') { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'coveragePercent is required for a PARTIAL coverage policy.' } }); return; }
    const coveragePercent = typeof body.coveragePercent === 'number' ? body.coveragePercent : (coverageType === 'FULL' ? 100 : 0);
    const now = new Date().toISOString();
    const policy = insurancePolicy(`pol_example_${7000 + policySeq}`, body.patientId, payer.id, body.policyNumber, coverageType, coveragePercent, typeof body.validityEnd === 'string' && body.validityEnd.length > 0 ? body.validityEnd : null);
    policy.validityStart = typeof body.validityStart === 'string' && body.validityStart.length > 0 ? body.validityStart : null;
    policy.isActive = body.isActive === false ? false : true; policy.createdAt = now; policy.updatedAt = now;
    policySeq += 1;
    LIVE_POLICIES.push(policy);
    send(response, 201, { success: true, data: { policy } });
    return;
  }

  if (url.pathname === '/insurance/claims' && request.method === 'GET') {
    const invoiceId = url.searchParams.get('invoiceId');
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    const items = LIVE_CLAIMS.filter((claim) =>
      (!invoiceId || claim.invoiceId === invoiceId) &&
      (!patientId || claim.patientId === patientId) &&
      (!status || claim.status === status));
    send(response, 200, listEnvelope(items.map((claim) => ({ ...claim }))));
    return;
  }

  if (url.pathname === '/insurance/claims' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const invoice = billingFind(typeof body.invoiceId === 'string' ? body.invoiceId : '');
    if (!invoice) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Invoice not found' } }); return; }
    const policy = LIVE_POLICIES.find((row) => row.id === body.policyId && row.isActive);
    if (!policy) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Insurance policy not found' } }); return; }
    if (policy.patientId !== invoice.patientId) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'The policy belongs to a different patient than the invoice.' } }); return; }
    const amount = typeof body.amount === 'string' && body.amount.length > 0 ? body.amount : invoice.total;
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || billingCents(amount) > billingCents(invoice.total)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A claim cannot exceed the invoice total.' } }); return; }
    const now = new Date().toISOString();
    const claim = insuranceClaim({ id: `claim_example_${5000 + claimSeq}`, claimNumber: `CLM-2026-${String(claimSeq).padStart(6, '0')}`, invoiceId: invoice.id, policyId: policy.id, patientId: invoice.patientId, amount, status: 'DRAFT', notes: typeof body.notes === 'string' && body.notes.length > 0 ? body.notes : null });
    claim.createdAt = now; claim.updatedAt = now;
    claimSeq += 1;
    LIVE_CLAIMS.push(claim);
    send(response, 201, { success: true, data: { claim } });
    return;
  }

  const claimAction = url.pathname.match(/^\/insurance\/claims\/([^/]+)\/action$/);
  if (claimAction && request.method === 'POST') {
    const claim = insuranceFindClaim(claimAction[1]);
    if (!claim) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    const action = body.action;
    const now = new Date().toISOString();
    const money = (value) => typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value);
    if (action === 'submit') {
      if (claim.status !== 'DRAFT') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      claim.status = 'SUBMITTED'; claim.submittedAt = now;
    } else if (action === 'approve') {
      if (claim.status !== 'SUBMITTED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      const approved = money(body.approvedAmount) ? body.approvedAmount : claim.amount;
      if (billingCents(approved) > billingCents(claim.amount)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
      if (billingCents(approved) < billingCents(claim.amount)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Use partial_approve.' } }); return; }
      claim.status = 'APPROVED'; claim.approvedAmount = approved; claim.approvedAt = now;
    } else if (action === 'partial_approve') {
      if (claim.status !== 'SUBMITTED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      if (!money(body.approvedAmount)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'approvedAmount required.' } }); return; }
      if (billingCents(body.approvedAmount) >= billingCents(claim.amount) || billingCents(body.approvedAmount) <= 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
      claim.status = 'PARTIALLY_APPROVED'; claim.approvedAmount = body.approvedAmount; claim.approvedAt = now;
    } else if (action === 'deny') {
      if (claim.status !== 'SUBMITTED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      if (typeof body.reason !== 'string' || body.reason.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A deny reason is required.' } }); return; }
      claim.status = 'DENIED'; claim.denyReason = body.reason; claim.deniedAt = now;
    } else if (action === 'pay') {
      if (claim.status !== 'APPROVED' && claim.status !== 'PARTIALLY_APPROVED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
      claim.status = 'PAID'; claim.paidAt = now;
    } else {
      send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Unknown claim action.' } });
      return;
    }
    claim.version += 1; claim.updatedAt = now;
    send(response, 200, { success: true, data: { claim } });
    return;
  }

  const claimOne = url.pathname.match(/^\/insurance\/claims\/([^/]+)$/);
  if (claimOne && request.method === 'GET') {
    const claim = insuranceFindClaim(claimOne[1]);
    if (!claim) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { claim } });
    return;
  }

  // --- inpatient (F8 ward board) -----------------------------------------
  if (url.pathname === '/wards' && request.method === 'GET') {
    const branchId = url.searchParams.get('branchId');
    const active = url.searchParams.get('active');
    const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20') || 20));
    const filtered = LIVE_WARDS.filter((ward) =>
      (!branchId || ward.branchId === branchId) &&
      (active === null || String(ward.isActive) === active));
    const start = (page - 1) * limit;
    const rows = filtered.slice(start, start + limit);
    send(response, 200, { success: true, data: rows, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }

  if (url.pathname === '/wards' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.name !== 'string' || body.name.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A ward name is required.' } }); return; }
    if (body.branchId !== INPATIENT_BRANCH_ID) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Branch not found' } }); return; }
    const now = new Date().toISOString();
    const ward = { id: `ward_example_${wardSeq++}`, organizationId: INPATIENT_ORG, branchId: INPATIENT_BRANCH_ID, name: body.name, code: typeof body.code === 'string' && body.code.length > 0 ? body.code : null, floor: typeof body.floor === 'string' && body.floor.length > 0 ? body.floor : null, description: typeof body.description === 'string' && body.description.length > 0 ? body.description : null, isActive: true, createdAt: now, updatedAt: now, rooms: [] };
    LIVE_WARDS.push(ward);
    send(response, 201, { success: true, data: { ward } });
    return;
  }

  const wardRoomCreate = url.pathname.match(/^\/wards\/([^/]+)\/rooms$/);
  if (wardRoomCreate && request.method === 'POST') {
    const ward = findWard(wardRoomCreate[1]);
    if (!ward) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Ward not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.name !== 'string' || body.name.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A room name is required.' } }); return; }
    const now = new Date().toISOString();
    const room = { id: `room_example_${roomSeq++}`, organizationId: INPATIENT_ORG, wardId: ward.id, name: body.name, description: typeof body.description === 'string' && body.description.length > 0 ? body.description : null, createdAt: now, updatedAt: now, beds: [] };
    ward.rooms.push(room);
    send(response, 201, { success: true, data: { room } });
    return;
  }

  const roomBedCreate = url.pathname.match(/^\/rooms\/([^/]+)\/beds$/);
  if (roomBedCreate && request.method === 'POST') {
    const found = findRoom(roomBedCreate[1]);
    if (!found) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Room not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.bedNumber !== 'string' || body.bedNumber.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A bed number is required.' } }); return; }
    const now = new Date().toISOString();
    const bed = { id: `bed_example_${bedSeq++}`, organizationId: INPATIENT_ORG, roomId: found.room.id, bedNumber: body.bedNumber, status: 'AVAILABLE', version: 1, createdAt: now, updatedAt: now };
    found.room.beds.push(bed);
    send(response, 201, { success: true, data: { bed } });
    return;
  }

  const bedStatus = url.pathname.match(/^\/beds\/([^/]+)\/status$/);
  if (bedStatus && request.method === 'PATCH') {
    const found = findBed(bedStatus[1]);
    if (!found) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Bed not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    if (typeof body.status !== 'string' || !MANUAL_BED_STATUSES.includes(body.status)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Bed status must be AVAILABLE, RESERVED, CLEANING, MAINTENANCE or BLOCKED.' } }); return; }
    if (typeof body.version !== 'number' || body.version !== found.bed.version) { send(response, 409, { success: false, error: { code: 'OPTIMISTIC_LOCK_CONFLICT' } }); return; }
    found.bed.status = body.status; found.bed.version += 1; found.bed.updatedAt = new Date().toISOString();
    send(response, 200, { success: true, data: { bed: found.bed } });
    return;
  }

  const wardOne = url.pathname.match(/^\/wards\/([^/]+)$/);
  if (wardOne && request.method === 'GET') {
    const ward = findWard(wardOne[1]);
    if (!ward) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { ward } });
    return;
  }

  // --- inpatient: admissions (F8 slice 2) --------------------------------
  if (url.pathname === '/admissions' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20') || 20));
    const filtered = LIVE_ADMISSIONS.filter((admission) =>
      (!patientId || admission.patientId === patientId) &&
      (!status || admission.status === status)).sort((a, b) => b.admittedAt.localeCompare(a.admittedAt));
    const start = (page - 1) * limit;
    const rows = filtered.slice(start, start + limit);
    send(response, 200, { success: true, data: rows, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }

  if (url.pathname === '/admissions' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const patientId = typeof body.patientId === 'string' && body.patientId.length > 0 ? body.patientId : null;
    const bedId = typeof body.bedId === 'string' && body.bedId.length > 0 ? body.bedId : null;
    if (!patientId || !bedId) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A patient and a bed are required.' } }); return; }
    if (body.branchId !== INPATIENT_BRANCH_ID) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Branch not found' } }); return; }
    const bed = findBed(bedId);
    if (!bed) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Bed not found' } }); return; }
    if (LIVE_ADMISSIONS.some((a) => a.patientId === patientId && a.status === 'ADMITTED')) { send(response, 409, { success: false, error: { code: 'ADMISSION_ALREADY_ACTIVE' } }); return; }
    if (!bedAssignable(bedId)) { send(response, 409, { success: false, error: { code: 'BED_UNAVAILABLE' } }); return; }
    const now = new Date().toISOString();
    const id = `adm_example_${admissionSeq++}`;
    const admission = { id, admissionNumber: `ADM-${now.slice(0, 4)}-${String(admissionSeq - 1).padStart(6, '0')}`, patientId, branchId: INPATIENT_BRANCH_ID, departmentId: typeof body.departmentId === 'string' && body.departmentId ? body.departmentId : null, encounterId: typeof body.encounterId === 'string' && body.encounterId ? body.encounterId : null, source: 'OUTPATIENT_CLINIC', status: 'ADMITTED', admittedById: 'usr_example_0001', admittedAt: now, expectedDischargeAt: typeof body.expectedDischargeAt === 'string' && body.expectedDischargeAt ? body.expectedDischargeAt : null, provisionalDiagnosis: typeof body.provisionalDiagnosis === 'string' && body.provisionalDiagnosis ? body.provisionalDiagnosis : null, version: 1, assignments: [{ id: `asg_example_${assignmentSeq++}`, bedId, admissionId: id, assignedById: 'usr_example_0001', assignedAt: now, releasedById: null, releasedAt: null, reason: null }], discharge: null };
    LIVE_ADMISSIONS.push(admission);
    bed.bed.status = 'OCCUPIED'; bed.bed.version += 1; bed.bed.updatedAt = now;
    send(response, 201, { success: true, data: { admission } });
    return;
  }

  const transferMatch = url.pathname.match(/^\/admissions\/([^/]+)\/transfer$/);
  if (transferMatch && request.method === 'POST') {
    const admission = findAdmission(transferMatch[1]);
    if (!admission) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Admission not found' } }); return; }
    if (admission.status !== 'ADMITTED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    const toBedId = typeof body.toBedId === 'string' && body.toBedId.length > 0 ? body.toBedId : null;
    if (!toBedId) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A target bed is required.' } }); return; }
    const active = activeAssignment(admission);
    if (!active) { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    if (active.bedId === toBedId) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (!bedAssignable(toBedId)) { send(response, 409, { success: false, error: { code: 'BED_UNAVAILABLE' } }); return; }
    const now = new Date().toISOString();
    const previous = findBed(active.bedId);
    active.releasedById = 'usr_example_0001'; active.releasedAt = now; active.reason = typeof body.reason === 'string' && body.reason ? body.reason : null;
    if (previous) { previous.bed.status = 'AVAILABLE'; previous.bed.version += 1; previous.bed.updatedAt = now; }
    const target = findBed(toBedId);
    if (target) { target.bed.status = 'OCCUPIED'; target.bed.version += 1; target.bed.updatedAt = now; }
    admission.assignments.push({ id: `asg_example_${assignmentSeq++}`, bedId: toBedId, admissionId: admission.id, assignedById: 'usr_example_0001', assignedAt: now, releasedById: null, releasedAt: null, reason: null });
    admission.version += 1;
    send(response, 201, { success: true, data: { admission } });
    return;
  }

  const dischargeMatch = url.pathname.match(/^\/admissions\/([^/]+)\/discharge$/);
  if (dischargeMatch && request.method === 'POST') {
    const admission = findAdmission(dischargeMatch[1]);
    if (!admission) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Admission not found' } }); return; }
    if (admission.status !== 'ADMITTED') { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { body = {}; }
    const now = new Date().toISOString();
    admission.discharge = { id: `dsc_example_${dischargeSeq++}`, admissionId: admission.id, dischargedById: 'usr_example_0001', dischargedAt: typeof body.dischargedAt === 'string' && body.dischargedAt ? body.dischargedAt : now, summary: typeof body.summary === 'string' && body.summary ? body.summary : null, instructions: typeof body.instructions === 'string' && body.instructions ? body.instructions : null, followUp: body.followUp && typeof body.followUp === 'object' && typeof body.followUp.type === 'string' ? body.followUp : null, hasOutstandingBilling: body.hasOutstandingBilling === true };
    admission.status = 'DISCHARGED';
    admission.version += 1;
    const active = activeAssignment(admission);
    if (active) {
      active.releasedById = 'usr_example_0001'; active.releasedAt = now;
      const bed = findBed(active.bedId);
      if (bed) { bed.bed.status = 'CLEANING'; bed.bed.version += 1; bed.bed.updatedAt = now; }
    }
    send(response, 201, { success: true, data: { admission } });
    return;
  }

  const admissionOne = url.pathname.match(/^\/admissions\/([^/]+)$/);
  if (admissionOne && request.method === 'GET') {
    const admission = findAdmission(admissionOne[1]);
    if (!admission) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { admission } });
    return;
  }

  // --- emergency: ED desk (F8 slice 3) -----------------------------------
  if (url.pathname === '/emergency/visits' && request.method === 'GET') {
    const branchId = url.searchParams.get('branchId');
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    const priority = url.searchParams.get('priority');
    const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20') || 20));
    const filtered = LIVE_EMERGENCY_VISITS.filter((visit) =>
      (!branchId || visit.branchId === branchId) &&
      (!patientId || visit.patientId === patientId) &&
      (!status || visit.status === status) &&
      (!priority || visit.priority === priority)).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
    const start = (page - 1) * limit;
    const rows = filtered.slice(start, start + limit);
    send(response, 200, { success: true, data: rows, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }

  if (url.pathname === '/emergency/summary' && request.method === 'GET') {
    const terminal = LIVE_EMERGENCY_VISITS.filter((visit) => EMERGENCY_TERMINAL.includes(visit.status));
    const byPriority = {};
    for (const visit of LIVE_EMERGENCY_VISITS) if (visit.priority) byPriority[visit.priority] = (byPriority[visit.priority] ?? 0) + 1;
    const byDisposition = {};
    for (const visit of LIVE_EMERGENCY_VISITS) if (visit.disposition) byDisposition[visit.disposition] = (byDisposition[visit.disposition] ?? 0) + 1;
    const minutes = (from, to) => (to ? (new Date(to).getTime() - new Date(from).getTime()) / 60000 : 0);
    const avg = (rows, pick) => (rows.length === 0 ? 0 : Math.round((rows.reduce((sum, visit) => sum + pick(visit), 0) / rows.length) * 10) / 10);
    const triaged = LIVE_EMERGENCY_VISITS.filter((visit) => visit.triagedAt);
    const disposed = LIVE_EMERGENCY_VISITS.filter((visit) => visit.dispositionAt);
    send(response, 200, { success: true, data: { period: 'TODAY', arrivals: LIVE_EMERGENCY_VISITS.length, active: LIVE_EMERGENCY_VISITS.length - terminal.length, avgMinutesToTriage: avg(triaged, (visit) => minutes(visit.arrivedAt, visit.triagedAt)), avgMinutesToDisposition: avg(disposed, (visit) => minutes(visit.arrivedAt, visit.dispositionAt)), byPriority, byDisposition } });
    return;
  }

  if (url.pathname === '/emergency/visits' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const patientId = typeof body.patientId === 'string' && body.patientId.length > 0 ? body.patientId : null;
    if (!patientId) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A patient is required.' } }); return; }
    if (body.branchId !== INPATIENT_BRANCH_ID) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Branch not found' } }); return; }
    const now = new Date().toISOString();
    const id = `erv_example_${emergencyVisitSeq++}`;
    const visit = stubEmergencyVisit(id, `ER-${now.slice(0, 4)}-${String(emergencyVisitSeq - 1).padStart(6, '0')}`, patientId, { arrivedAt: typeof body.arrivedAt === 'string' && body.arrivedAt ? body.arrivedAt : now, version: 1, createdAt: now, updatedAt: now });
    LIVE_EMERGENCY_VISITS.push(visit);
    send(response, 201, { success: true, data: { visit } });
    return;
  }

  const emergencyAction = url.pathname.match(/^\/emergency\/visits\/([^/]+)\/(triage|assess|treat|observe|admit|refer|discharge)$/);
  if (emergencyAction && request.method === 'POST') {
    const visit = findEmergencyVisit(emergencyAction[1]);
    if (!visit) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Emergency visit not found' } }); return; }
    if (EMERGENCY_TERMINAL.includes(visit.status)) { send(response, 409, { success: false, error: { code: 'EMERGENCY_VISIT_CLOSED' } }); return; }
    const action = emergencyAction[2];
    if (!EMERGENCY_SOURCES[action].includes(visit.status)) { send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION' } }); return; }
    let body = {};
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { /* optional body */ }
    const now = new Date().toISOString();
    if (action === 'triage') {
      if (!EMERGENCY_PRIORITIES.includes(body.priority)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid priority is required.' } }); return; }
      visit.status = 'TRIAGED'; visit.priority = body.priority; visit.chiefComplaint = typeof body.complaint === 'string' && body.complaint ? body.complaint : null; visit.triagedById = 'usr_example_0001'; visit.triagedAt = now;
    } else if (action === 'assess') {
      visit.status = 'ASSESSED'; visit.assessment = typeof body.assessment === 'string' && body.assessment ? body.assessment : null; visit.assessedAt = now;
    } else if (action === 'treat') {
      visit.status = 'IN_TREATMENT'; visit.treatment = typeof body.treatment === 'string' && body.treatment ? body.treatment : null; visit.treatmentStartedAt = now;
    } else if (action === 'observe') {
      visit.status = 'OBSERVATION'; visit.observedAt = now;
    } else if (action === 'admit') {
      const bedId = typeof body.bedId === 'string' && body.bedId.length > 0 ? body.bedId : null;
      if (!bedId) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A bed is required.' } }); return; }
      if (!findBed(bedId)) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Bed not found' } }); return; }
      if (LIVE_ADMISSIONS.some((a) => a.patientId === visit.patientId && a.status === 'ADMITTED')) { send(response, 409, { success: false, error: { code: 'ADMISSION_ALREADY_ACTIVE' } }); return; }
      if (!bedAssignable(bedId)) { send(response, 409, { success: false, error: { code: 'BED_UNAVAILABLE' } }); return; }
      const admission = stubCreateAdmission(visit.patientId, bedId, 'EMERGENCY', typeof body.departmentId === 'string' && body.departmentId ? body.departmentId : null, typeof body.provisionalDiagnosis === 'string' && body.provisionalDiagnosis ? body.provisionalDiagnosis : null, typeof body.expectedDischargeAt === 'string' && body.expectedDischargeAt ? body.expectedDischargeAt : null);
      visit.status = 'ADMITTED'; visit.disposition = 'ADMITTED'; visit.dispositionAt = now; visit.admittedAdmissionId = admission.id;
    } else if (action === 'refer') {
      const referredTo = typeof body.referredTo === 'string' && body.referredTo.length > 0 ? body.referredTo : null;
      if (!referredTo) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A referral destination is required.' } }); return; }
      visit.status = 'REFERRED'; visit.disposition = 'REFERRED'; visit.dispositionAt = now; visit.referredTo = referredTo; visit.referralNotes = typeof body.referralNotes === 'string' && body.referralNotes ? body.referralNotes : null;
    } else if (action === 'discharge') {
      visit.status = 'DISCHARGED'; visit.disposition = 'DISCHARGED'; visit.dispositionAt = now;
    }
    visit.version += 1; visit.updatedAt = now;
    send(response, 201, { success: true, data: { visit } });
    return;
  }

  const emergencyPriority = url.pathname.match(/^\/emergency\/visits\/([^/]+)\/priority$/);
  if (emergencyPriority && request.method === 'PATCH') {
    const visit = findEmergencyVisit(emergencyPriority[1]);
    if (!visit) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Emergency visit not found' } }); return; }
    if (EMERGENCY_TERMINAL.includes(visit.status)) { send(response, 409, { success: false, error: { code: 'EMERGENCY_VISIT_CLOSED' } }); return; }
    let body = {};
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { /* optional body */ }
    if (!EMERGENCY_PRIORITIES.includes(body.priority)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid priority is required.' } }); return; }
    visit.priority = body.priority; visit.version += 1; visit.updatedAt = new Date().toISOString();
    send(response, 200, { success: true, data: { visit } });
    return;
  }

  const emergencyOne = url.pathname.match(/^\/emergency\/visits\/([^/]+)$/);
  if (emergencyOne && request.method === 'GET') {
    const visit = findEmergencyVisit(emergencyOne[1]);
    if (!visit) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { visit } });
    return;
  }

  // --- administration (F9 users and roles) -------------------------------
  // Mirrors src/mocks/admin-handlers.ts and the service: a duplicate email or
  // staff number is a 409, the calling user cannot manage itself, and a role set
  // must reference real roles.
  if (url.pathname === '/users' && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20') || 20));
    const filtered = LIVE_ADMIN_USERS.filter((user) => {
      if (status && user.status !== status) return false;
      if (q) {
        const haystack = `${user.email} ${user.firstName} ${user.otherNames ?? ''} ${user.lastName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (page - 1) * limit;
    const rows = filtered.slice(start, start + limit);
    send(response, 200, { success: true, data: rows, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }

  if (url.pathname === '/users' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const email = typeof body.email === 'string' && body.email ? body.email : null;
    const firstName = typeof body.firstName === 'string' && body.firstName ? body.firstName : null;
    const lastName = typeof body.lastName === 'string' && body.lastName ? body.lastName : null;
    if (!email || !firstName || !lastName) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Email, first name and last name are required.' } }); return; }
    if (LIVE_ADMIN_USERS.some((user) => user.email.toLowerCase() === email.toLowerCase())) { send(response, 409, { success: false, error: { code: 'CONFLICT', message: 'A user with that email already exists.' } }); return; }
    let staff = null;
    if (body.staff && typeof body.staff === 'object') {
      const staffNumber = typeof body.staff.staffNumber === 'string' && body.staff.staffNumber ? body.staff.staffNumber : null;
      if (!staffNumber) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A staff number is required.' } }); return; }
      if (LIVE_ADMIN_USERS.some((user) => user.staff && user.staff.staffNumber === staffNumber)) { send(response, 409, { success: false, error: { code: 'CONFLICT', message: 'A staff member with that number already exists.' } }); return; }
      staff = adminStaff(`stf_example_${adminUserSeq}`, staffNumber, typeof body.staff.professionalTitle === 'string' ? body.staff.professionalTitle : null, typeof body.staff.specialization === 'string' ? body.staff.specialization : null, typeof body.staff.employmentStatus === 'string' ? body.staff.employmentStatus : 'ACTIVE');
    }
    const roleIds = adminStringList(body.roleIds);
    const resolved = roleIds.length > 0 ? resolveAdminRoles(roleIds) : [];
    if (resolved === null) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'One or more roles do not exist.' } }); return; }
    const now = new Date().toISOString();
    const user = { id: `usr_example_${String(adminUserSeq).padStart(4, '0')}`, email, firstName, lastName, otherNames: typeof body.otherNames === 'string' && body.otherNames ? body.otherNames : null, phone: typeof body.phone === 'string' && body.phone ? body.phone : null, status: 'INVITED', createdAt: now, roles: resolved, staff };
    LIVE_ADMIN_USERS.push(user);
    adminUserSeq += 1;
    send(response, 201, { success: true, data: { user, inviteToken: `tok_example_${adminUserSeq}` } });
    return;
  }

  const adminUserRoles = url.pathname.match(/^\/users\/([^/]+)\/roles$/);
  if (adminUserRoles && request.method === 'POST') {
    const user = findAdminUser(adminUserRoles[1]);
    if (!user) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const roleIds = adminStringList(body.roleIds);
    if (roleIds.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one role is required.' } }); return; }
    const resolved = resolveAdminRoles(roleIds);
    if (resolved === null) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'One or more roles do not exist.' } }); return; }
    user.roles = resolved;
    send(response, 200, { success: true, data: { user } });
    return;
  }

  const adminUserRevoke = url.pathname.match(/^\/users\/([^/]+)\/sessions\/revoke$/);
  if (adminUserRevoke && request.method === 'POST') {
    const user = findAdminUser(adminUserRevoke[1]);
    if (!user) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found' } }); return; }
    send(response, 200, { success: true, data: { revoked: user.status === 'ACTIVE' ? 2 : 0 } });
    return;
  }

  const adminUserOne = url.pathname.match(/^\/users\/([^/]+)$/);
  if (adminUserOne) {
    const user = findAdminUser(adminUserOne[1]);
    if (!user) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found' } }); return; }
    if (request.method === 'GET') { send(response, 200, { success: true, data: { user } }); return; }
    if (request.method === 'PATCH') {
      if (adminUserOne[1] === ADMIN_CALLER_ID) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot self-manage through this endpoint.' } }); return; }
      let body;
      try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
      if (typeof body.firstName === 'string') user.firstName = body.firstName;
      if (typeof body.lastName === 'string') user.lastName = body.lastName;
      if ('otherNames' in body) user.otherNames = typeof body.otherNames === 'string' && body.otherNames ? body.otherNames : null;
      if ('phone' in body) user.phone = typeof body.phone === 'string' && body.phone ? body.phone : null;
      if (typeof body.status === 'string' && ADMIN_USER_STATUSES.includes(body.status)) user.status = body.status;
      send(response, 200, { success: true, data: { user } });
      return;
    }
    if (request.method === 'DELETE') {
      if (adminUserOne[1] === ADMIN_CALLER_ID) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot self-manage through this endpoint.' } }); return; }
      user.status = 'DEACTIVATED';
      send(response, 204, undefined);
      return;
    }
  }

  if (url.pathname === '/roles' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20') || 20));
    const filtered = LIVE_ADMIN_ROLES.filter((role) => (!q || `${role.name} ${role.key}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.isSystem !== b.isSystem ? (a.isSystem ? -1 : 1) : a.name.localeCompare(b.name)));
    const start = (page - 1) * limit;
    const rows = filtered.slice(start, start + limit);
    send(response, 200, { success: true, data: rows, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }

  if (url.pathname === '/roles' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const name = typeof body.name === 'string' && body.name ? body.name : null;
    const key = typeof body.key === 'string' && body.key ? body.key : null;
    const permissions = adminStringList(body.permissions);
    if (!name || !key) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Name and key are required.' } }); return; }
    if (!ADMIN_ROLE_KEY_PATTERN.test(key) || key.length > 48) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'The key must be uppercase letters, digits and underscores.' } }); return; }
    if (permissions.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one permission is required.' } }); return; }
    if (LIVE_ADMIN_ROLES.some((role) => role.key === key || role.name === name)) { send(response, 409, { success: false, error: { code: 'CONFLICT', message: 'A role with this key or name already exists.' } }); return; }
    const role = {
      id: `rol_example_${String(adminRoleSeq).padStart(4, '0')}`,
      key,
      name,
      description: typeof body.description === 'string' && body.description ? body.description : null,
      isSystem: false,
      permissions,
      createdAt: new Date().toISOString(),
    };
    LIVE_ADMIN_ROLES.push(role);
    adminRoleSeq += 1;
    send(response, 201, { success: true, data: { role } });
    return;
  }

  if (url.pathname === '/roles/permissions' && request.method === 'GET') {
    send(response, 200, { success: true, data: LIVE_ROLE_CATALOG });
    return;
  }

  const adminRoleOne = url.pathname.match(/^\/roles\/([^/]+)$/);
  if (adminRoleOne && request.method === 'GET') {
    const role = findAdminRole(adminRoleOne[1]);
    if (!role) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Role not found' } }); return; }
    send(response, 200, { success: true, data: { role } });
    return;
  }

  if (adminRoleOne && request.method === 'PATCH') {
    const role = findAdminRole(adminRoleOne[1]);
    if (!role) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Role not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if ('permissions' in body) {
      if (role.isSystem) { send(response, 403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'Only an administrator with full authority may edit a system role.' } }); return; }
      const permissions = adminStringList(body.permissions);
      if (permissions.length === 0) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one permission is required.' } }); return; }
      role.permissions = permissions;
    }
    if (typeof body.name === 'string' && body.name && body.name !== role.name) {
      if (LIVE_ADMIN_ROLES.some((entry) => entry.id !== role.id && entry.name === body.name)) { send(response, 409, { success: false, error: { code: 'CONFLICT', message: 'A role with this name already exists.' } }); return; }
      role.name = body.name;
    }
    if ('description' in body) role.description = typeof body.description === 'string' && body.description ? body.description : null;
    send(response, 200, { success: true, data: { role } });
    return;
  }

  if (adminRoleOne && request.method === 'DELETE') {
    const role = findAdminRole(adminRoleOne[1]);
    if (!role) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Role not found' } }); return; }
    if (role.isSystem) { send(response, 403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'System roles cannot be deleted by this account.' } }); return; }
    const assigned = LIVE_ADMIN_USERS.some((user) => user.roles.some((ref) => ref.id === role.id));
    if (assigned) { send(response, 409, { success: false, error: { code: 'CONFLICT', message: 'Role is assigned to users; remove the assignments first.' } }); return; }
    LIVE_ADMIN_ROLES.splice(LIVE_ADMIN_ROLES.indexOf(role), 1);
    send(response, 204, undefined);
    return;
  }

  // --- staff directory (F9) ----------------------------------------------
  // Mirrors src/mocks/staff-handlers.ts: identity is never editable, and every
  // branch/department id must exist or the whole assignment set is refused.
  if (url.pathname === '/staff' && request.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20') || 20));
    const filtered = LIVE_ADMIN_STAFF.filter((entry) => {
      if (!q) return true;
      const haystack = `${entry.staffNumber} ${entry.professionalTitle ?? ''} ${entry.specialization ?? ''} ${entry.user.firstName} ${entry.user.lastName} ${entry.user.email}`;
      return haystack.toLowerCase().includes(q);
    }).sort((a, b) => a.staffNumber.localeCompare(b.staffNumber));
    const rows = filtered.slice(0, limit).map(serializeStaff);
    send(response, 200, { success: true, data: rows, meta: { page: 1, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }

  const adminStaffAssignments = url.pathname.match(/^\/staff\/([^/]+)\/assignments$/);
  if (adminStaffAssignments && request.method === 'POST') {
    const entry = findAdminStaff(adminStaffAssignments[1]);
    if (!entry) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Staff profile not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const branchIds = adminStringList(body.branchIds);
    const departmentIds = adminStringList(body.departmentIds);
    if (branchIds.some((id) => !findStaffBranch(id))) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'One or more branches do not exist.' } }); return; }
    if (departmentIds.some((id) => !findStaffDepartment(id))) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'One or more departments do not exist.' } }); return; }
    entry.branchIds = branchIds;
    entry.departmentIds = departmentIds;
    send(response, 200, { success: true, data: { staff: serializeStaff(entry) } });
    return;
  }

  const adminStaffOne = url.pathname.match(/^\/staff\/([^/]+)$/);
  if (adminStaffOne) {
    const entry = findAdminStaff(adminStaffOne[1]);
    if (!entry) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Staff profile not found' } }); return; }
    if (request.method === 'GET') { send(response, 200, { success: true, data: { staff: serializeStaff(entry) } }); return; }
    if (request.method === 'PATCH') {
      let body;
      try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
      if ('professionalTitle' in body) entry.professionalTitle = typeof body.professionalTitle === 'string' && body.professionalTitle ? body.professionalTitle : null;
      if ('specialization' in body) entry.specialization = typeof body.specialization === 'string' && body.specialization ? body.specialization : null;
      if ('licenseNumber' in body) entry.licenseNumber = typeof body.licenseNumber === 'string' && body.licenseNumber ? body.licenseNumber : null;
      if (typeof body.employmentStatus === 'string' && STAFF_EMPLOYMENT_STATUSES.includes(body.employmentStatus)) entry.employmentStatus = body.employmentStatus;
      send(response, 200, { success: true, data: { staff: serializeStaff(entry) } });
      return;
    }
  }

  if (url.pathname === '/branches' && request.method === 'GET') {
    send(response, 200, listEnvelope(STAFF_BRANCHES.map((branch) => ({ ...branch })), 100));
    return;
  }

  // --- organization profile (F9) -----------------------------------------
  // Mirrors src/mocks/admin-handlers.ts: one organization; an email that clashes
  // with an account is a 409 and an empty patch is a 400.
  if (url.pathname === '/organizations/me' && request.method === 'GET') {
    send(response, 200, { success: true, data: { organization: { ...LIVE_ORGANIZATION } } });
    return;
  }
  if (url.pathname === '/organizations/me' && request.method === 'PATCH') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (!ORGANIZATION_EDITABLE.some((field) => field in body)) { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Nothing to update.' } }); return; }
    if ('email' in body && typeof body.email === 'string' && body.email && LIVE_ADMIN_USERS.some((user) => user.email.toLowerCase() === body.email.toLowerCase())) {
      send(response, 409, { success: false, error: { code: 'CONFLICT', message: 'That email is already in use by an account.' } }); return;
    }
    for (const field of ORGANIZATION_EDITABLE) {
      if (field in body) LIVE_ORGANIZATION[field] = typeof body[field] === 'string' && body[field] ? body[field] : null;
    }
    LIVE_ORGANIZATION.updatedAt = new Date().toISOString();
    send(response, 200, { success: true, data: { organization: { ...LIVE_ORGANIZATION } } });
    return;
  }

  // --- reports (F10 report-export desk) ----------------------------------
  // Mirrors src/mocks/report-handlers.ts: the export history, the request write
  // (202 + PENDING), the polling detail read, and the download stream (409 while
  // not READY, 410 once expired). The download writes raw bytes, bypassing the
  // JSON `send` helper, so `content-disposition` survives to the browser.
  if (url.pathname === '/reports/exports' && request.method === 'GET') {
    const reportType = url.searchParams.get('reportType');
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25') || 25));
    const filtered = LIVE_REPORTS.filter((report) => !reportType || report.reportType === reportType)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit).map((report) => ({ ...report }));
    send(response, 200, { success: true, data: slice, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } });
    return;
  }
  if (url.pathname === '/reports/export' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (typeof body.reportType !== 'string' || !REPORT_TYPES.includes(body.reportType)) { send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A known report type is required.' } }); return; }
    if (typeof body.format !== 'string' || !REPORT_FORMATS.includes(body.format)) { send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR', message: 'A known format is required.' } }); return; }
    const createdAt = new Date().toISOString();
    const report = {
      id: `rep_example_${String(REPORT_SEQ).padStart(4, '0')}`,
      reportType: body.reportType,
      format: body.format,
      status: 'PENDING',
      contentType: REPORT_CONTENT_TYPES[body.format] ?? null,
      sizeBytes: null,
      summary: null,
      error: null,
      expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
      createdAt,
      completedAt: null,
    };
    REPORT_SEQ += 1;
    LIVE_REPORTS.unshift(report);
    send(response, 202, { success: true, data: { ...report } });
    return;
  }
  const reportDownload = url.pathname.match(/^\/reports\/exports\/([^/]+)\/download$/);
  if (reportDownload && request.method === 'GET') {
    const report = LIVE_REPORTS.find((entry) => entry.id === reportDownload[1]);
    if (!report) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Report export not found' } }); return; }
    if (report.status !== 'READY') {
      const status = report.status === 'EXPIRED' ? 410 : 409;
      const code = report.status === 'EXPIRED' ? 'RESOURCE_EXPIRED' : 'CONFLICT';
      const message = report.status === 'EXPIRED' ? 'Report has expired (exports are available for 24 hours)' : `Report is ${report.status.toLowerCase()}, not downloadable`;
      send(response, status, { success: false, error: { code, message } });
      return;
    }
    const payload = 'summary,row\n"total",12\n';
    response.writeHead(200, {
      'content-type': report.contentType ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${report.reportType.toLowerCase()}-${report.id}.csv"`,
      'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
    return;
  }
  const reportMatch = url.pathname.match(/^\/reports\/exports\/([^/]+)$/);
  if (reportMatch && request.method === 'GET') {
    const report = LIVE_REPORTS.find((entry) => entry.id === reportMatch[1]);
    if (!report) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Report export not found' } }); return; }
    send(response, 200, { success: true, data: { ...report } });
    return;
  }


  // --- laboratory results (F4 doctor results view) -----------------------
  if (url.pathname === '/lab/orders' && request.method === 'POST') {    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const testIds = Array.isArray(body.testIds) ? body.testIds.filter((id) => typeof id === 'string') : [];
    const firstTest = LIVE_LAB_TESTS.find((t) => t.id === testIds[0]);
    if (!body.patientId || !body.branchId || testIds.length === 0 || !firstTest) {
      send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR', message: 'patientId, branchId and at least one test are required.' } });
      return;
    }
    const orderId = `lab_example_${labCreatedOrderSeq}`;
    const sampleNumber = `S-2026-${String(labCreatedSampleSeq).padStart(6, '0')}`;
    const sampleId = `lbs_example_${labCreatedSampleSeq}`;
    const orderNumber = `LAB-2026-${String(labCreatedOrderSeq).padStart(6, '0')}`;
    labCreatedOrderSeq += 1;
    labCreatedSampleSeq += 1;
    const _items = testIds.map((testId) => {
      const test = LIVE_LAB_TESTS.find((t) => t.id === testId);
      return { id: `loi_example_${labItemSeq++}`, testId, testCode: test?.code ?? '', testName: test?.name ?? '', notes: null, results: [] };
    });
    const order = {
      id: orderId, organizationId: 'org_example_0001', orderNumber, patientId: body.patientId,
      branchId: body.branchId, encounterId: body.encounterId ?? null, status: 'ORDERED',
      priority: body.priority ?? 'ROUTINE', clinicalNotes: body.clinicalNotes ?? null,
      orderedById: 'usr_example_9001', orderedAt: new Date().toISOString(), releasedById: null,
      releasedAt: null, cancelledById: null, cancelledAt: null, cancelledReason: null,
      rejectionReason: null, version: 1,
      sample: { id: sampleId, organizationId: 'org_example_0001', sampleNumber, orderId, patientId: body.patientId, branchId: body.branchId, sampleType: firstTest.sampleType, status: 'ORDERED', collectedAt: null, receivedAt: null, processingAt: null, completedAt: null, rejectedAt: null, rejectedReason: null, recollectsFromOrderId: null },
      _items, criticalResults: [],
    };
    LIVE_LAB_ORDERS.unshift(order);
    send(response, 201, { success: true, data: { order: serializeLabOrderDetail(order) } });
    return;
  }

  if (url.pathname === '/lab/orders' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const branchId = url.searchParams.get('branchId');
    const status = url.searchParams.get('status');
    let items = [...LIVE_LAB_ORDERS];
    if (patientId) items = items.filter((o) => o.patientId === patientId);
    if (branchId) items = items.filter((o) => o.branchId === branchId);
    if (status) items = items.filter((o) => o.status === status);
    items.sort((a, b) => Date.parse(b.orderedAt) - Date.parse(a.orderedAt));
    send(response, 200, listEnvelope(items.map(serializeLabOrderSummary), 50));
    return;
  }

  if (url.pathname === '/lab/tests' && request.method === 'GET') {
    const active = url.searchParams.get('active');
    let items = [...LIVE_LAB_TESTS];
    if (active) items = items.filter((t) => t.isActive === (active === 'true'));
    send(response, 200, listEnvelope(items, 100));
    return;
  }

  if (url.pathname.match(/^\/lab\/orders\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const order = LIVE_LAB_ORDERS.find((o) => o.id === id);
    if (!order) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { order: serializeLabOrderDetail(order) } });
    return;
  }

  // --- laboratory worklist writes (F5) ----------------------------------
  // Mirror the MSW handlers and the server's state machine against the same
  // in-memory order list, so a transition taken in the UI is reflected on the
  // next read (and a stale move answers 409).
  const labWrite = url.pathname.match(/^\/lab\/orders\/([^/]+)\/(collect|receive|process|reject|cancel|verify|release|results)$/);
  if (labWrite && request.method === 'POST') {
    const order = LIVE_LAB_ORDERS.find((o) => o.id === labWrite[1]);
    const action = labWrite[2];
    if (!order) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Lab order not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const conflict = (message, code = 'INVALID_WORKFLOW_TRANSITION') => send(response, 409, { success: false, error: { code, message } });
    const now = new Date().toISOString();
    if (action === 'collect') {
      if (order.status !== 'ORDERED') { conflict('Only an ordered sample can be collected.'); return; }
      order.status = 'COLLECTED';
      if (order.sample) { order.sample.status = 'COLLECTED'; order.sample.collectedAt = now; }
    } else if (action === 'receive') {
      if (order.status !== 'COLLECTED') { conflict('Only a collected sample can be received.'); return; }
      order.status = 'RECEIVED';
      if (order.sample) { order.sample.status = 'RECEIVED'; order.sample.receivedAt = now; }
    } else if (action === 'process') {
      if (order.status !== 'RECEIVED') { conflict('Only a received sample can be processed.'); return; }
      order.status = 'PROCESSING';
      if (order.sample) { order.sample.status = 'PROCESSING'; order.sample.processingAt = now; }
    } else if (action === 'reject') {
      if (order.status !== 'COLLECTED' && order.status !== 'RECEIVED') { conflict('Only a collected or received sample can be rejected.'); return; }
      order.status = 'REJECTED';
      order.rejectionReason = typeof body.reason === 'string' ? body.reason : '';
      if (order.sample) { order.sample.status = 'REJECTED'; order.sample.rejectedAt = now; order.sample.rejectedReason = order.rejectionReason; }
    } else if (action === 'cancel') {
      if (order.status !== 'ORDERED' && order.status !== 'COLLECTED') { conflict('This order can no longer be cancelled.'); return; }
      order.status = 'CANCELLED';
      order.cancelledAt = now;
      order.cancelledById = 'usr_example_9001';
      order.cancelledReason = typeof body.reason === 'string' ? body.reason : '';
      if (order.sample) order.sample.status = 'ORDERED';
    } else if (action === 'results') {
      if (order.status !== 'PROCESSING') { conflict('Results can only be entered for an order in progress.'); return; }
      const index = labFieldIndex();
      for (const submitted of Array.isArray(body.results) ? body.results : []) {
        const field = index.get(submitted && submitted.testFieldId);
        if (!field) { conflict('A result points at a field this order does not carry.'); return; }
        const item = order._items.find((row) => (LIVE_LAB_TESTS.find((t) => t.id === row.testId)?.fields ?? []).some((f) => f.id === field.id));
        if (!item) continue;
        const value = typeof submitted.value === 'string' ? submitted.value : '';
        const flags = classifyLabValue(field, value);
        const resultId = `lbr_example_${labResultSeq++}`;
        item.results.push({ id: resultId, organizationId: 'org_example_0001', orderItemId: item.id, testFieldId: field.id, currentVersion: 1, value, isAbnormal: flags.isAbnormal, isCritical: flags.isCritical, amendments: 0 });
        if (flags.isCritical) {
          order.criticalResults.push({ id: `lcr_example_${labCriticalSeq++}`, organizationId: 'org_example_0001', resultId, notifiedToId: order.orderedById ?? 'usr_example_9001', notifiedAt: now, acknowledgedById: null, acknowledgedAt: null, escalationAt: null });
        }
      }
      order.status = 'RESULT_READY';
      if (order.sample) { order.sample.status = 'COMPLETED'; order.sample.completedAt = now; }
    } else if (action === 'verify') {
      if (order.status !== 'RESULT_READY') { conflict('Only a result-ready order can be verified.'); return; }
      order.status = 'VERIFIED';
    } else if (action === 'release') {
      if (order.status !== 'VERIFIED') { conflict('Only a verified order can be released.'); return; }
      if (order.criticalResults.some((row) => row.acknowledgedAt === null)) { conflict('Acknowledge every critical result before releasing.', 'LAB_RESULT_NOT_ACKNOWLEDGED'); return; }
      order.status = 'RELEASED';
      order.releasedById = 'usr_example_9002';
      order.releasedAt = now;
    }
    send(response, 201, { success: true, data: { order: serializeLabOrderDetail(order) } });
    return;
  }

  const labAmend = url.pathname.match(/^\/lab\/results\/([^/]+)$/);
  if (labAmend && request.method === 'PATCH') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    for (const order of LIVE_LAB_ORDERS) {
      for (const item of order._items) {
        const result = item.results.find((row) => row.id === labAmend[1]);
        if (result) {
          const field = labFieldIndex().get(result.testFieldId);
          const flags = classifyLabValue(field, typeof body.value === 'string' ? body.value : result.value);
          if (typeof body.value === 'string') result.value = body.value;
          result.isAbnormal = flags.isAbnormal;
          result.isCritical = flags.isCritical;
          result.currentVersion += 1;
          result.amendments += 1;
          send(response, 200, { success: true, data: { result } });
          return;
        }
      }
    }
    send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Result not found' } });
    return;
  }

  const labAcknowledge = url.pathname.match(/^\/lab\/critical\/([^/]+)\/acknowledge$/);
  if (labAcknowledge && request.method === 'POST') {
    for (const order of LIVE_LAB_ORDERS) {
      const critical = order.criticalResults.find((row) => row.id === labAcknowledge[1]);
      if (critical) {
        if (!critical.acknowledgedAt) {
          critical.acknowledgedById = 'usr_example_9002';
          critical.acknowledgedAt = new Date().toISOString();
        }
        send(response, 201, { success: true, data: { criticalResult: critical } });
        return;
      }
    }
    send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Critical result not found' } });
    return;
  }

  // --- radiology results (F4 doctor results view) ------------------------
  if (url.pathname === '/radiology/orders' && request.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    if (!body.patientId || !body.branchId || !body.modality) {
      send(response, 422, { success: false, error: { code: 'VALIDATION_ERROR', message: 'patientId, branchId and modality are required.' } });
      return;
    }
    const order = {
      id: `rad_example_${radiologyCreatedOrderSeq}`,
      organizationId: 'org_example_0001',
      orderNumber: `RAD-2026-${String(radiologyCreatedOrderSeq).padStart(6, '0')}`,
      patientId: body.patientId, branchId: body.branchId, encounterId: body.encounterId ?? null,
      modality: body.modality, region: body.region ?? null, status: 'ORDERED',
      clinicalNotes: body.clinicalNotes ?? null, orderedById: 'usr_example_9001',
      orderedAt: new Date().toISOString(), requestedAt: body.requestedAt ?? null,
      performedById: null, performedAt: null, cancelledById: null, cancelledAt: null,
      cancelledReason: null, releasedById: null, releasedAt: null, version: 1, report: null,
    };
    radiologyCreatedOrderSeq += 1;
    LIVE_RADIOLOGY_ORDERS.unshift(order);
    send(response, 201, { success: true, data: { order } });
    return;
  }

  if (url.pathname === '/radiology/orders' && request.method === 'GET') {
    const patientId = url.searchParams.get('patientId');
    const branchId = url.searchParams.get('branchId');
    const status = url.searchParams.get('status');
    let items = [...LIVE_RADIOLOGY_ORDERS];
    if (patientId) items = items.filter((o) => o.patientId === patientId);
    if (branchId) items = items.filter((o) => o.branchId === branchId);
    if (status) items = items.filter((o) => o.status === status);
    items.sort((a, b) => Date.parse(b.orderedAt) - Date.parse(a.orderedAt));
    send(response, 200, listEnvelope(items, 50));
    return;
  }

  if (url.pathname.match(/^\/radiology\/orders\/[^/]+$/) && request.method === 'GET') {
    const id = url.pathname.split('/').slice(-1)[0];
    const order = LIVE_RADIOLOGY_ORDERS.find((o) => o.id === id);
    if (!order) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } }); return; }
    send(response, 200, { success: true, data: { order } });
    return;
  }

  // --- radiology worklist writes (F5) -----------------------------------
  // Mirror the MSW handlers and the server's state machine against the same
  // in-memory order list, so a transition taken in the UI is reflected on the
  // next read (and a stale move answers 409).
  const radiologyWrite = url.pathname.match(/^\/radiology\/orders\/([^/]+)\/(schedule|perform|report|verify|release|cancel)$/);
  if (radiologyWrite && request.method === 'POST') {
    const order = LIVE_RADIOLOGY_ORDERS.find((o) => o.id === radiologyWrite[1]);
    const action = radiologyWrite[2];
    if (!order) { send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Radiology order not found' } }); return; }
    let body;
    try { body = JSON.parse((await readBody(request)) || '{}'); } catch { send(response, 400, { success: false, error: { code: 'VALIDATION_ERROR' } }); return; }
    const conflict = (message) => send(response, 409, { success: false, error: { code: 'INVALID_WORKFLOW_TRANSITION', message } });
    const now = new Date().toISOString();
    if (action === 'schedule') {
      if (order.status !== 'ORDERED') { conflict('Only an ordered study can be scheduled.'); return; }
      order.status = 'SCHEDULED';
      order.requestedAt = now;
    } else if (action === 'perform') {
      if (order.status !== 'SCHEDULED') { conflict('Only a scheduled study can be performed.'); return; }
      order.status = 'PERFORMED';
      order.performedAt = now;
      order.performedById = 'usr_example_9002';
    } else if (action === 'report') {
      if (order.status !== 'PERFORMED') { conflict('Only a performed study can be reported.'); return; }
      order.status = 'REPORTED';
      order.report = { id: `imr_example_${radiologyReportSeq++}`, organizationId: 'org_example_0001', orderId: order.id, findings: typeof body.findings === 'string' ? body.findings : null, summary: typeof body.summary === 'string' ? body.summary : null, impression: typeof body.impression === 'string' ? body.impression : null, enteredById: 'usr_example_9002', enteredAt: now, verifiedById: null, verifiedAt: null, version: 1 };
    } else if (action === 'verify') {
      if (order.status !== 'REPORTED') { conflict('Only a reported study can be verified.'); return; }
      order.status = 'VERIFIED';
      if (order.report) { order.report.verifiedById = 'usr_example_9003'; order.report.verifiedAt = now; }
    } else if (action === 'release') {
      if (order.status !== 'VERIFIED') { conflict('Only a verified study can be released.'); return; }
      order.status = 'RELEASED';
      order.releasedById = 'usr_example_9003';
      order.releasedAt = now;
    } else if (action === 'cancel') {
      if (order.status !== 'ORDERED' && order.status !== 'SCHEDULED') { conflict('This study can no longer be cancelled.'); return; }
      order.status = 'CANCELLED';
      order.cancelledAt = now;
      order.cancelledById = 'usr_example_9001';
      order.cancelledReason = typeof body.reason === 'string' ? body.reason : '';
    }
    send(response, 201, { success: true, data: { order } });
    return;
  }

  send(response, 404, { success: false, error: { code: 'RESOURCE_NOT_FOUND' } });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-api listening on http://127.0.0.1:${PORT}\n`);
});
