import { SCHEDULING_BRANCH_ID } from '@/lib/data/scheduling';

/**
 * F3 scheduling fixtures.
 *
 * Fabricated throughout and prefixed EXAMPLE, per `src/mocks/handlers.ts`. The same
 * records appear in `e2e/stub-api.mjs`, so a screenshot taken in mock dev matches
 * what the production build renders.
 *
 * Appointments and waitlist offers are stored as *minute offsets from the UTC
 * business day* and stamped at handler load, because the desk defaults to today
 * and a fixed timestamp would fall out of the day book tomorrow. This mirrors how
 * the queue fixtures store `enteredMinutesAgo`.
 *
 * `dayOfWeek` follows the API's workweek (0=MONDAY .. 6=SUNDAY), not
 * `Date.getDay()` — see `schedules/domain/workweek.ts`.
 */

export const SCHEDULING_BRANCH = SCHEDULING_BRANCH_ID;

export interface ProviderFixture {
  readonly id: string;
  readonly name: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly bookable: boolean;
  readonly professionalTitle: string | null;
  readonly specialization: string | null;
  readonly departmentIds: readonly string[];
  readonly branchIds: readonly string[];
  readonly status: string;
}

export const PROVIDERS: readonly ProviderFixture[] = [
  {
    id: 'usr_example_9101',
    name: 'EXAMPLE Dr N. Wanjiru',
    firstName: 'EXAMPLE Dr',
    lastName: 'Wanjiru',
    bookable: true,
    professionalTitle: 'Consultant Physician',
    specialization: 'Internal Medicine',
    departmentIds: ['dep_example_outpatient'],
    branchIds: [SCHEDULING_BRANCH],
    status: 'ACTIVE',
  },
  {
    id: 'usr_example_9102',
    name: 'EXAMPLE Dr O. Mwangi',
    firstName: 'EXAMPLE Dr',
    lastName: 'Mwangi',
    bookable: true,
    professionalTitle: 'Paediatrician',
    specialization: 'Paediatrics',
    departmentIds: ['dep_example_outpatient', 'dep_example_paediatrics'],
    branchIds: [SCHEDULING_BRANCH],
    status: 'ACTIVE',
  },
  {
    id: 'usr_example_9103',
    name: 'EXAMPLE Dr A. Otieno',
    firstName: 'EXAMPLE Dr',
    lastName: 'Otieno',
    bookable: true,
    professionalTitle: 'Emergency Physician',
    specialization: 'Emergency Medicine',
    departmentIds: ['dep_example_emergency'],
    branchIds: [SCHEDULING_BRANCH],
    status: 'ACTIVE',
  },
  {
    id: 'usr_example_9104',
    name: 'EXAMPLE Dr F. Hassan',
    firstName: 'EXAMPLE Dr',
    lastName: 'Hassan',
    bookable: true,
    professionalTitle: 'Obstetrician',
    specialization: 'Obstetrics',
    departmentIds: ['dep_example_maternity'],
    branchIds: [SCHEDULING_BRANCH],
    status: 'ACTIVE',
  },
];

export interface ScheduleTemplateFixture {
  readonly providerId: string;
  readonly departmentId: string;
  readonly dayOfWeek: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly slotDurationMinutes: number;
  readonly capacity: number;
}

/** Monday–Friday 08:00–13:00 in 30-minute slots, for every example provider. */
export const SCHEDULES: readonly ScheduleTemplateFixture[] = PROVIDERS.flatMap((provider) =>
  [0, 1, 2, 3, 4].map((dayOfWeek) => ({
    providerId: provider.id,
    departmentId: provider.departmentIds[0] as string,
    dayOfWeek,
    startMinutes: 480,
    endMinutes: 780,
    slotDurationMinutes: 30,
    capacity: 1,
  })),
);

export interface AppointmentFixture {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string;
  readonly departmentId: string;
  readonly mode: 'IN_PERSON' | 'VIRTUAL';
  readonly appointmentType: string | null;
  readonly reason: string | null;
  readonly status: string;
  /** Minutes since UTC midnight of the business day. */
  readonly startMinutes: number;
}

export const APPOINTMENTS: readonly AppointmentFixture[] = [
  {
    id: 'apt_example_4001',
    patientId: 'pat_example_1001',
    providerId: 'usr_example_9101',
    departmentId: 'dep_example_outpatient',
    mode: 'IN_PERSON',
    appointmentType: 'Follow-up',
    reason: 'Blood pressure review.',
    status: 'CONFIRMED',
    startMinutes: 540,
  },
  {
    id: 'apt_example_4002',
    patientId: 'pat_example_1002',
    providerId: 'usr_example_9101',
    departmentId: 'dep_example_outpatient',
    mode: 'IN_PERSON',
    appointmentType: 'New patient',
    reason: 'Knee pain, referred by physiotherapy.',
    status: 'BOOKED',
    startMinutes: 600,
  },
  {
    id: 'apt_example_4003',
    patientId: 'pat_example_1003',
    providerId: 'usr_example_9102',
    departmentId: 'dep_example_paediatrics',
    mode: 'IN_PERSON',
    appointmentType: 'Vaccination',
    reason: null,
    status: 'CHECKED_IN',
    startMinutes: 570,
  },
  {
    id: 'apt_example_4004',
    patientId: 'pat_example_1004',
    providerId: 'usr_example_9101',
    departmentId: 'dep_example_outpatient',
    mode: 'VIRTUAL',
    appointmentType: 'Review',
    reason: 'Telephone review of results.',
    status: 'COMPLETED',
    startMinutes: 480,
  },
  {
    id: 'apt_example_4005',
    patientId: 'pat_example_1002',
    providerId: 'usr_example_9103',
    departmentId: 'dep_example_emergency',
    mode: 'IN_PERSON',
    appointmentType: null,
    reason: 'Wound check.',
    status: 'NO_SHOW',
    startMinutes: 660,
  },
];

export const FIRST_APPOINTMENT_SEQUENCE = 6;

export interface WaitlistFixture {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string | null;
  readonly departmentId: string;
  readonly status: string;
  /** Minutes since UTC midnight, for an OFFERED entry's held slot. */
  readonly offerMinutes: number | null;
  readonly notes: string | null;
}

export const WAITLIST: readonly WaitlistFixture[] = [
  {
    id: 'wl_example_5001',
    patientId: 'pat_example_1002',
    providerId: null,
    departmentId: 'dep_example_outpatient',
    status: 'WAITING',
    offerMinutes: null,
    notes: 'Prefers mornings.',
  },
  {
    id: 'wl_example_5002',
    patientId: 'pat_example_1004',
    providerId: 'usr_example_9101',
    departmentId: 'dep_example_outpatient',
    status: 'OFFERED',
    offerMinutes: 720,
    notes: null,
  },
  {
    id: 'wl_example_5003',
    patientId: 'pat_example_1003',
    providerId: null,
    departmentId: 'dep_example_maternity',
    status: 'WAITING',
    offerMinutes: null,
    notes: 'Needs an interpreter.',
  },
];

export const FIRST_WAITLIST_SEQUENCE = 4;

/** 0=MONDAY .. 6=SUNDAY for an instant, matching the API's convention. */
export function workdayIndexFor(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}
