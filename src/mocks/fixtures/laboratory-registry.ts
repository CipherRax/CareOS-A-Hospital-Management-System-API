/**
 * F4/F5 laboratory fixtures (doctor results view + lab worklist).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`, and
 * duplicated deliberately in `e2e/stub-api.mjs` so mock dev and the production
 * build's e2e render the same content. Patient ids line up with
 * `patients-registry.ts`; encounter ids with `encounters-registry.ts`.
 *
 * Orders carry the **full** item/result tree here; the handlers split it into the
 * thin list projection the API's list read really returns versus the full detail
 * the single read answers with. The spread of statuses is deliberate: the
 * worklist needs an order sitting at every point of the pipeline so each
 * transition can be exercised against the mock.
 */

export interface LabFieldFixture {
  readonly id: string;
  readonly name: string;
  readonly fieldType: string;
  readonly unit: string | null;
  readonly referenceMin: string | null;
  readonly referenceMax: string | null;
  readonly criticalMin: string | null;
  readonly criticalMax: string | null;
  readonly allowsValues: string | null;
  readonly displayOrder: number;
  readonly isActive: boolean;
}

export interface LabTestFixture {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly sampleType: string;
  readonly isActive: boolean;
  readonly fields: readonly LabFieldFixture[];
}

export interface LabResultFixture {
  readonly testFieldId: string;
  readonly value: string;
  readonly isAbnormal: boolean;
  readonly isCritical: boolean;
  /** A critical notification is created for every critical result; this is
   * whether it was then acknowledged. Defaults to false. */
  readonly acknowledged?: boolean;
}

export interface LabItemFixture {
  readonly testId: string;
  readonly notes: string | null;
  readonly results: readonly LabResultFixture[];
}

export interface LabOrderFixture {
  readonly id: string;
  readonly orderNumber: string;
  readonly patientId: string;
  readonly encounterId: string | null;
  readonly status: string;
  readonly priority: string;
  readonly orderedMinutesAgo: number;
  readonly releasedMinutesAgo: number | null;
  readonly cancelledMinutesAgo: number | null;
  readonly cancelReason: string | null;
  readonly rejectionReason: string | null;
  readonly clinicalNotes?: string | null;
  readonly items: readonly LabItemFixture[];
}

export interface LabSampleFixture {
  readonly id: string;
  readonly sampleNumber: string;
  readonly sampleType: string;
}

export const LAB_BRANCH_ID = 'br_example_0001';
export const LAB_ORDERED_BY = 'usr_example_9001';
export const LAB_ORG_ID = 'org_example_0001';

export const LAB_TESTS: readonly LabTestFixture[] = [
  {
    id: 'lbt_example_5001',
    code: 'CBC',
    name: 'EXAMPLE Full blood count',
    sampleType: 'BLOOD',
    isActive: true,
    fields: [
      {
        id: 'lbf_example_5101',
        name: 'Haemoglobin',
        fieldType: 'NUMERIC',
        unit: 'g/dL',
        referenceMin: '12',
        referenceMax: '16',
        criticalMin: '7',
        criticalMax: '20',
        allowsValues: null,
        displayOrder: 1,
        isActive: true,
      },
      {
        id: 'lbf_example_5102',
        name: 'White cell count',
        fieldType: 'NUMERIC',
        unit: '10^9/L',
        referenceMin: '4',
        referenceMax: '11',
        criticalMin: '1',
        criticalMax: '30',
        allowsValues: null,
        displayOrder: 2,
        isActive: true,
      },
      {
        id: 'lbf_example_5103',
        name: 'Platelets',
        fieldType: 'NUMERIC',
        unit: '10^9/L',
        referenceMin: '150',
        referenceMax: '400',
        criticalMin: '20',
        criticalMax: '1000',
        allowsValues: null,
        displayOrder: 3,
        isActive: true,
      },
    ],
  },
  {
    id: 'lbt_example_5002',
    code: 'U&E',
    name: 'EXAMPLE Urea and electrolytes',
    sampleType: 'BLOOD',
    isActive: true,
    fields: [
      {
        id: 'lbf_example_5201',
        name: 'Sodium',
        fieldType: 'NUMERIC',
        unit: 'mmol/L',
        referenceMin: '135',
        referenceMax: '145',
        criticalMin: '120',
        criticalMax: '160',
        allowsValues: null,
        displayOrder: 1,
        isActive: true,
      },
      {
        id: 'lbf_example_5202',
        name: 'Potassium',
        fieldType: 'NUMERIC',
        unit: 'mmol/L',
        referenceMin: '3.5',
        referenceMax: '5.1',
        criticalMin: '2.5',
        criticalMax: '6.5',
        allowsValues: null,
        displayOrder: 2,
        isActive: true,
      },
      {
        id: 'lbf_example_5203',
        name: 'Creatinine',
        fieldType: 'NUMERIC',
        unit: 'mg/dL',
        referenceMin: '0.6',
        referenceMax: '1.3',
        criticalMin: '0.2',
        criticalMax: '4',
        allowsValues: null,
        displayOrder: 3,
        isActive: true,
      },
    ],
  },
];

export const LAB_ORDERS: readonly LabOrderFixture[] = [
  {
    id: 'lab_example_5001',
    orderNumber: 'LAB-2026-000001',
    encounterId: 'enc_example_6001',
    patientId: 'pat_example_1001',
    status: 'RELEASED',
    priority: 'ROUTINE',
    orderedMinutesAgo: 35,
    releasedMinutesAgo: 10,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    clinicalNotes: 'Requested during this visit.',
    items: [
      {
        testId: 'lbt_example_5001',
        notes: null,
        results: [
          { testFieldId: 'lbf_example_5101', value: '13.9', isAbnormal: false, isCritical: false },
          { testFieldId: 'lbf_example_5102', value: '12.5', isAbnormal: true, isCritical: false },
          { testFieldId: 'lbf_example_5103', value: '241', isAbnormal: false, isCritical: false },
        ],
      },
    ],
  },
  {
    id: 'lab_example_5002',
    orderNumber: 'LAB-2026-000002',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'RELEASED',
    priority: 'URGENT',
    orderedMinutesAgo: 30,
    releasedMinutesAgo: 4,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    clinicalNotes: 'Repeat in 24 hours.',
    items: [
      {
        testId: 'lbt_example_5002',
        notes: 'Repeat in 24 hours.',
        results: [
          { testFieldId: 'lbf_example_5201', value: '138', isAbnormal: false, isCritical: false },
          {
            testFieldId: 'lbf_example_5202',
            value: '6.2',
            isAbnormal: true,
            isCritical: true,
            acknowledged: true,
          },
          { testFieldId: 'lbf_example_5203', value: '1.1', isAbnormal: false, isCritical: false },
        ],
      },
    ],
  },
  {
    id: 'lab_example_5003',
    orderNumber: 'LAB-2026-000003',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'PROCESSING',
    priority: 'ROUTINE',
    orderedMinutesAgo: 20,
    releasedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    items: [{ testId: 'lbt_example_5001', notes: null, results: [] }],
  },
  {
    id: 'lab_example_5004',
    orderNumber: 'LAB-2026-000004',
    patientId: 'pat_example_1002',
    encounterId: 'enc_example_6002',
    status: 'RELEASED',
    priority: 'STAT',
    orderedMinutesAgo: 55,
    releasedMinutesAgo: 12,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    items: [
      {
        testId: 'lbt_example_5001',
        notes: null,
        results: [
          { testFieldId: 'lbf_example_5101', value: '9.4', isAbnormal: true, isCritical: false },
        ],
      },
    ],
  },
  {
    id: 'lab_example_5005',
    orderNumber: 'LAB-2026-000005',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'ORDERED',
    priority: 'ROUTINE',
    orderedMinutesAgo: 8,
    releasedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    items: [{ testId: 'lbt_example_5002', notes: null, results: [] }],
  },
  {
    id: 'lab_example_5006',
    orderNumber: 'LAB-2026-000006',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'COLLECTED',
    priority: 'ROUTINE',
    orderedMinutesAgo: 30,
    releasedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    items: [{ testId: 'lbt_example_5001', notes: null, results: [] }],
  },
  {
    id: 'lab_example_5007',
    orderNumber: 'LAB-2026-000007',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'RECEIVED',
    priority: 'URGENT',
    orderedMinutesAgo: 45,
    releasedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    items: [{ testId: 'lbt_example_5002', notes: null, results: [] }],
  },
  {
    id: 'lab_example_5008',
    orderNumber: 'LAB-2026-000008',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'RESULT_READY',
    priority: 'STAT',
    orderedMinutesAgo: 50,
    releasedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: null,
    items: [
      {
        testId: 'lbt_example_5002',
        notes: null,
        results: [
          { testFieldId: 'lbf_example_5201', value: '136', isAbnormal: false, isCritical: false },
          { testFieldId: 'lbf_example_5202', value: '6.8', isAbnormal: true, isCritical: true },
          { testFieldId: 'lbf_example_5203', value: '1.0', isAbnormal: false, isCritical: false },
        ],
      },
    ],
  },
  {
    id: 'lab_example_5009',
    orderNumber: 'LAB-2026-000008',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'REJECTED',
    priority: 'ROUTINE',
    orderedMinutesAgo: 90,
    releasedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
    rejectionReason: 'EXAMPLE Haemolysed sample — recollection requested.',
    items: [{ testId: 'lbt_example_5001', notes: null, results: [] }],
  },
  {
    id: 'lab_example_5010',
    orderNumber: 'LAB-2026-000009',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    status: 'CANCELLED',
    priority: 'ROUTINE',
    orderedMinutesAgo: 60,
    releasedMinutesAgo: null,
    cancelledMinutesAgo: 50,
    cancelReason: 'Duplicate of an earlier request.',
    rejectionReason: null,
    items: [{ testId: 'lbt_example_5001', notes: null, results: [] }],
  },
];

export const LAB_SAMPLE: Readonly<Record<string, LabSampleFixture>> = {
  lab_example_5001: { id: 'lbs_example_6001', sampleNumber: 'S-2026-000001', sampleType: 'BLOOD' },
  lab_example_5002: { id: 'lbs_example_6002', sampleNumber: 'S-2026-000002', sampleType: 'BLOOD' },
  lab_example_5003: { id: 'lbs_example_6003', sampleNumber: 'S-2026-000003', sampleType: 'BLOOD' },
  lab_example_5004: { id: 'lbs_example_6004', sampleNumber: 'S-2026-000004', sampleType: 'BLOOD' },
  lab_example_5005: { id: 'lbs_example_6005', sampleNumber: 'S-2026-000005', sampleType: 'BLOOD' },
  lab_example_5006: { id: 'lbs_example_6006', sampleNumber: 'S-2026-000006', sampleType: 'BLOOD' },
  lab_example_5007: { id: 'lbs_example_6007', sampleNumber: 'S-2026-000007', sampleType: 'BLOOD' },
  lab_example_5008: { id: 'lbs_example_6008', sampleNumber: 'S-2026-000008', sampleType: 'BLOOD' },
  lab_example_5009: { id: 'lbs_example_6009', sampleNumber: 'S-2026-000009', sampleType: 'BLOOD' },
  lab_example_5010: { id: 'lbs_example_6010', sampleNumber: 'S-2026-000010', sampleType: 'BLOOD' },
};
