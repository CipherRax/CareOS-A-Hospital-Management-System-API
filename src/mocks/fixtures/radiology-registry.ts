/**
 * F4/F5 radiology fixtures: the doctor results view plus the F5 radiology
 * worklist.
 *
 * Fabricated and EXAMPLE-prefixed, duplicated in `e2e/stub-api.mjs`. The API's
 * radiology list serializes the full order including the report, so the handlers
 * return these whole. A spread across every status backs the worklist's action
 * bar (one order per reachable move).
 */

export const RADIOLOGY_ORG_ID = 'org_example_0001';
export const RADIOLOGY_BRANCH_ID = 'br_example_0001';
export const RADIOLOGY_ORDERED_BY = 'usr_example_9001';
export const RADIOLOGY_PERFORMED_BY = 'usr_example_9002';
export const RADIOLOGY_RELEASED_BY = 'usr_example_9003';

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
  readonly requestedMinutesAgo: number | null;
  readonly performedMinutesAgo: number | null;
  readonly cancelledMinutesAgo: number | null;
  readonly cancelReason: string | null;
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
    requestedMinutesAgo: 36,
    performedMinutesAgo: 20,
    cancelledMinutesAgo: null,
    cancelReason: null,
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
    requestedMinutesAgo: 3,
    performedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
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
    requestedMinutesAgo: 47,
    performedMinutesAgo: 30,
    cancelledMinutesAgo: null,
    cancelReason: null,
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
  {
    id: 'rad_example_4004',
    orderNumber: 'RAD-2026-000004',
    patientId: 'pat_example_1003',
    encounterId: 'enc_example_6003',
    modality: 'MRI',
    region: 'Knee',
    status: 'ORDERED',
    clinicalNotes: 'Twisting injury, suspected meniscal tear.',
    orderedMinutesAgo: 2,
    requestedMinutesAgo: null,
    performedMinutesAgo: null,
    cancelledMinutesAgo: null,
    cancelReason: null,
    releasedMinutesAgo: null,
    report: null,
  },
  {
    id: 'rad_example_4005',
    orderNumber: 'RAD-2026-000005',
    patientId: 'pat_example_1004',
    encounterId: null,
    modality: 'XRAY',
    region: 'Chest',
    status: 'PERFORMED',
    clinicalNotes: 'Pre-operative assessment.',
    orderedMinutesAgo: 40,
    requestedMinutesAgo: 38,
    performedMinutesAgo: 10,
    cancelledMinutesAgo: null,
    cancelReason: null,
    releasedMinutesAgo: null,
    report: null,
  },
  {
    id: 'rad_example_4006',
    orderNumber: 'RAD-2026-000006',
    patientId: 'pat_example_1003',
    encounterId: null,
    modality: 'CT',
    region: 'Abdomen',
    status: 'REPORTED',
    clinicalNotes: 'Recurrent abdominal pain.',
    orderedMinutesAgo: 60,
    requestedMinutesAgo: 58,
    performedMinutesAgo: 25,
    cancelledMinutesAgo: null,
    cancelReason: null,
    releasedMinutesAgo: null,
    report: {
      id: 'imr_example_4006',
      findings: 'No bowel obstruction. Mild fat stranding in the right iliac fossa.',
      summary: 'Mild inflammatory change.',
      impression: 'Probable early appendicitis; correlate clinically.',
      enteredMinutesAgo: 8,
      verifiedMinutesAgo: null,
    },
  },
  {
    id: 'rad_example_4007',
    orderNumber: 'RAD-2026-000007',
    patientId: 'pat_example_1002',
    encounterId: null,
    modality: 'MRI',
    region: 'Spine',
    status: 'VERIFIED',
    clinicalNotes: 'Chronic low back pain.',
    orderedMinutesAgo: 90,
    requestedMinutesAgo: 88,
    performedMinutesAgo: 50,
    cancelledMinutesAgo: null,
    cancelReason: null,
    releasedMinutesAgo: null,
    report: {
      id: 'imr_example_4007',
      findings: 'L4/L5 disc bulge without nerve root compression.',
      summary: 'Degenerative disc disease.',
      impression: 'No surgical target identified.',
      enteredMinutesAgo: 30,
      verifiedMinutesAgo: 12,
    },
  },
  {
    id: 'rad_example_4008',
    orderNumber: 'RAD-2026-000008',
    patientId: 'pat_example_1004',
    encounterId: null,
    modality: 'ULTRASOUND',
    region: 'Pelvis',
    status: 'CANCELLED',
    clinicalNotes: 'Query ovarian pathology.',
    orderedMinutesAgo: 20,
    requestedMinutesAgo: null,
    performedMinutesAgo: null,
    cancelledMinutesAgo: 15,
    cancelReason: 'Patient declined; imaging to be rescheduled.',
    releasedMinutesAgo: null,
    report: null,
  },
];
