/**
 * F4 radiology fixtures (doctor results view).
 *
 * Fabricated and EXAMPLE-prefixed, duplicated in `e2e/stub-api.mjs`. The API's
 * radiology list serializes the full order including the report, so the handlers
 * return these whole.
 */

export interface ImagingReportFixture {
  readonly id: string;
  readonly findings: string | null;
  readonly summary: string | null;
  readonly impression: string | null;
  readonly enteredMinutesAgo: number | null;
  readonly verifiedMinutesAgo: number | null;
}

export interface RadiologyOrderFixture {
  readonly id: string;
  readonly orderNumber: string;
  readonly patientId: string;
  readonly encounterId: string | null;
  readonly modality: string;
  readonly region: string | null;
  readonly status: string;
  readonly clinicalNotes: string | null;
  readonly orderedMinutesAgo: number;
  readonly performedMinutesAgo: number | null;
  readonly releasedMinutesAgo: number | null;
  readonly report: ImagingReportFixture | null;
}

export const RADIOLOGY_ORDERS: readonly RadiologyOrderFixture[] = [
  {
    id: 'rad_example_4001',
    orderNumber: 'RAD-2026-000001',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    modality: 'XRAY',
    region: 'Chest',
    status: 'RELEASED',
    clinicalNotes: 'Persistent productive cough, query pneumonia.',
    orderedMinutesAgo: 38,
    performedMinutesAgo: 20,
    releasedMinutesAgo: 6,
    report: {
      id: 'imr_example_4001',
      findings: 'No focal consolidation or effusion. Cardiothoracic ratio within normal limits.',
      summary: 'Normal chest radiograph.',
      impression: 'No acute cardiopulmonary abnormality.',
      enteredMinutesAgo: 14,
      verifiedMinutesAgo: 8,
    },
  },
  {
    id: 'rad_example_4002',
    orderNumber: 'RAD-2026-000002',
    patientId: 'pat_example_1001',
    encounterId: 'enc_example_6001',
    modality: 'ULTRASOUND',
    region: 'Abdomen',
    status: 'SCHEDULED',
    clinicalNotes: 'Right upper quadrant pain.',
    orderedMinutesAgo: 5,
    performedMinutesAgo: null,
    releasedMinutesAgo: null,
    report: null,
  },
  {
    id: 'rad_example_4003',
    orderNumber: 'RAD-2026-000003',
    patientId: 'pat_example_1002',
    encounterId: 'enc_example_6002',
    modality: 'CT',
    region: 'Head',
    status: 'RELEASED',
    clinicalNotes: 'Sudden onset headache.',
    orderedMinutesAgo: 50,
    performedMinutesAgo: 30,
    releasedMinutesAgo: 15,
    report: {
      id: 'imr_example_4003',
      findings: 'No intracranial haemorrhage. Grey-white differentiation preserved.',
      summary: 'Unremarkable non-contrast CT head.',
      impression: 'No acute intracranial abnormality.',
      enteredMinutesAgo: 25,
      verifiedMinutesAgo: 18,
    },
  },
];
