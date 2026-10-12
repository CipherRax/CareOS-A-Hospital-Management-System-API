/**
 * F4 prescription fixtures (doctor workspace).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the
 * production-build e2e render the same prescription history. Patient, encounter
 * and provider ids line up with `encounters-registry.ts`; medication ids line
 * up with `medications-registry.ts`.
 */

export interface PrescriptionItemFixture {
  readonly id: string;
  readonly medicationId: string;
  readonly quantity: number;
  readonly dispensedQuantity: number;
  readonly dosage: string | null;
  readonly frequency: string | null;
  readonly durationDays: number | null;
  readonly instructions: string | null;
}

export interface PrescriptionFixture {
  readonly id: string;
  readonly patientId: string;
  readonly providerId: string;
  readonly status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_DISPENSED' | 'DISPENSED' | 'CANCELLED';
  readonly notes: string | null;
  readonly items: readonly PrescriptionItemFixture[];
  /** Stamped against the current clock so "issued" reads sensibly on any day. */
  readonly createdMinutesAgo: number;
  readonly issuedMinutesAgo: number | null;
  readonly dispensedMinutesAgo: number | null;
  readonly cancelledMinutesAgo: number | null;
  readonly cancelReason: string | null;
}

export const PRESCRIPTION_BRANCH_ID = 'br_example_0001';

/** Batch of items for one prescription (created now: createdAt = createdMinutesAgo). */
export const PRESCRIPTIONS: readonly PrescriptionFixture[] = [
  {
    id: 'prx_example_7001',
    patientId: 'pat_example_1001',
    providerId: 'usr_example_9001',
    status: 'DRAFT',
    notes: null,
    items: [
      {
        id: 'pri_example_7101',
        medicationId: 'med_example_7101',
        quantity: 21,
        dispensedQuantity: 0,
        dosage: '500mg',
        frequency: '8 hourly',
        durationDays: 7,
        instructions: 'Take after food.',
      },
    ],
    createdMinutesAgo: 9,
    issuedMinutesAgo: null,
    dispensedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
  },
  {
    id: 'prx_example_7002',
    patientId: 'pat_example_1001',
    providerId: 'usr_example_9001',
    status: 'ISSUED',
    notes: 'For headache not controlled by rest.',
    items: [
      {
        id: 'pri_example_7102',
        medicationId: 'med_example_7102',
        quantity: 12,
        dispensedQuantity: 0,
        dosage: '1g',
        frequency: 'when required, max 4 times daily',
        durationDays: null,
        instructions: 'Do not exceed four doses a day.',
      },
    ],
    createdMinutesAgo: 40,
    issuedMinutesAgo: 33,
    dispensedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
  },
  {
    id: 'prx_example_7003',
    patientId: 'pat_example_1002',
    providerId: 'usr_example_9002',
    status: 'DISPENSED',
    notes: null,
    items: [
      {
        id: 'pri_example_7103',
        medicationId: 'med_example_7103',
        quantity: 200,
        dispensedQuantity: 200,
        dosage: '200mcg (2 puffs)',
        frequency: 'when required',
        durationDays: 30,
        instructions: 'Use spacer in the emergency bay.',
      },
    ],
    createdMinutesAgo: 65,
    issuedMinutesAgo: 62,
    dispensedMinutesAgo: 50,
    cancelledMinutesAgo: null,
    cancelReason: null,
  },
  {
    id: 'prx_example_7004',
    patientId: 'pat_example_1003',
    providerId: 'usr_example_9003',
    status: 'CANCELLED',
    notes: null,
    items: [
      {
        id: 'pri_example_7104',
        medicationId: 'med_example_7101',
        quantity: 10,
        dispensedQuantity: 0,
        dosage: '250mg',
        frequency: '12 hourly',
        durationDays: 5,
        instructions: null,
      },
    ],
    createdMinutesAgo: 210,
    issuedMinutesAgo: null,
    dispensedMinutesAgo: null,
    cancelledMinutesAgo: 195,
    cancelReason: 'EXAMPLE changed the plan to amoxicillin–clavulanate.',
  },
];