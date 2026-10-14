/**
 * F7 insurance fixtures (payers, patient policies and claims).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the production
 * build's e2e run cannot silently drift.
 *
 * Claim `amount`/`approvedAmount` are decimal **strings** (ADR-029). The statuses
 * cover the whole claim lifecycle so every action branch in the workspace is
 * reachable: a draft to submit, a submitted claim to decide, an approved and a
 * partially approved claim to pay, plus a denied and a paid record.
 */

export interface RegistryInsurancePayer {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly contactPhone: string | null;
  readonly email: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegistryInsurancePolicy {
  readonly id: string;
  readonly organizationId: string;
  readonly patientId: string;
  readonly payerId: string;
  readonly policyNumber: string;
  readonly coverageType: 'FULL' | 'PARTIAL';
  readonly coveragePercent: number;
  readonly validityStart: string | null;
  readonly validityEnd: string | null;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegistryInsuranceClaim {
  readonly id: string;
  readonly organizationId: string;
  readonly claimNumber: string;
  readonly invoiceId: string;
  readonly policyId: string;
  readonly patientId: string;
  readonly amount: string;
  readonly status:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'PARTIALLY_APPROVED'
    | 'DENIED'
    | 'PAID';
  readonly notes: string | null;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly approvedAmount: string | null;
  readonly deniedAt: string | null;
  readonly denyReason: string | null;
  readonly paidAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const INSURANCE_ORGANIZATION_ID = 'org_example_1';
const STAMP = '2026-10-01T08:00:00.000Z';

export const INSURANCE_PAYERS: readonly RegistryInsurancePayer[] = [
  {
    id: 'payer_example_6001',
    organizationId: INSURANCE_ORGANIZATION_ID,
    name: 'EXAMPLE Jubilee Health',
    contactPhone: '+254700000010',
    email: 'claims@example.org',
    isActive: true,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'payer_example_6002',
    organizationId: INSURANCE_ORGANIZATION_ID,
    name: 'EXAMPLE AAR Insurance',
    contactPhone: '+254700000011',
    email: 'health@example.org',
    isActive: true,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
];

export const INSURANCE_POLICIES: readonly RegistryInsurancePolicy[] = [
  {
    id: 'pol_example_7001',
    organizationId: INSURANCE_ORGANIZATION_ID,
    patientId: 'pat_example_1001',
    payerId: 'payer_example_6001',
    policyNumber: 'POL-2026-000001',
    coverageType: 'PARTIAL',
    coveragePercent: 80,
    validityStart: '2026-01-01T00:00:00.000Z',
    validityEnd: '2026-12-31T00:00:00.000Z',
    isActive: true,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'pol_example_7002',
    organizationId: INSURANCE_ORGANIZATION_ID,
    patientId: 'pat_example_1002',
    payerId: 'payer_example_6002',
    policyNumber: 'POL-2026-000002',
    coverageType: 'FULL',
    coveragePercent: 100,
    validityStart: '2026-01-01T00:00:00.000Z',
    validityEnd: '2026-12-31T00:00:00.000Z',
    isActive: true,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'pol_example_7003',
    organizationId: INSURANCE_ORGANIZATION_ID,
    patientId: 'pat_example_1003',
    payerId: 'payer_example_6001',
    policyNumber: 'POL-2026-000003',
    coverageType: 'PARTIAL',
    coveragePercent: 50,
    validityStart: '2026-01-01T00:00:00.000Z',
    validityEnd: null,
    isActive: true,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
];

export const INSURANCE_CLAIMS: readonly RegistryInsuranceClaim[] = [
  {
    id: 'claim_example_5001',
    organizationId: INSURANCE_ORGANIZATION_ID,
    claimNumber: 'CLM-2026-000001',
    invoiceId: 'inv_example_8001',
    policyId: 'pol_example_7001',
    patientId: 'pat_example_1001',
    amount: '1500.00',
    status: 'DRAFT',
    notes: 'EXAMPLE claim awaiting submission.',
    submittedAt: null,
    approvedAt: null,
    approvedAmount: null,
    deniedAt: null,
    denyReason: null,
    paidAt: null,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'claim_example_5002',
    organizationId: INSURANCE_ORGANIZATION_ID,
    claimNumber: 'CLM-2026-000002',
    invoiceId: 'inv_example_8002',
    policyId: 'pol_example_7002',
    patientId: 'pat_example_1002',
    amount: '4200.00',
    status: 'SUBMITTED',
    notes: null,
    submittedAt: '2026-10-03T09:30:00.000Z',
    approvedAt: null,
    approvedAmount: null,
    deniedAt: null,
    denyReason: null,
    paidAt: null,
    version: 2,
    createdAt: STAMP,
    updatedAt: '2026-10-03T09:30:00.000Z',
  },
  {
    id: 'claim_example_5003',
    organizationId: INSURANCE_ORGANIZATION_ID,
    claimNumber: 'CLM-2026-000003',
    invoiceId: 'inv_example_8003',
    policyId: 'pol_example_7003',
    patientId: 'pat_example_1003',
    amount: '800.00',
    status: 'PAID',
    notes: null,
    submittedAt: '2026-10-03T10:00:00.000Z',
    approvedAt: '2026-10-04T11:00:00.000Z',
    approvedAmount: '800.00',
    deniedAt: null,
    denyReason: null,
    paidAt: '2026-10-05T12:00:00.000Z',
    version: 4,
    createdAt: STAMP,
    updatedAt: '2026-10-05T12:00:00.000Z',
  },
  {
    id: 'claim_example_5004',
    organizationId: INSURANCE_ORGANIZATION_ID,
    claimNumber: 'CLM-2026-000004',
    invoiceId: 'inv_example_8001',
    policyId: 'pol_example_7001',
    patientId: 'pat_example_1001',
    amount: '1500.00',
    status: 'PARTIALLY_APPROVED',
    notes: null,
    submittedAt: '2026-10-05T09:00:00.000Z',
    approvedAt: '2026-10-06T09:00:00.000Z',
    approvedAmount: '1000.00',
    deniedAt: null,
    denyReason: null,
    paidAt: null,
    version: 3,
    createdAt: STAMP,
    updatedAt: '2026-10-06T09:00:00.000Z',
  },
  {
    id: 'claim_example_5005',
    organizationId: INSURANCE_ORGANIZATION_ID,
    claimNumber: 'CLM-2026-000005',
    invoiceId: 'inv_example_8002',
    policyId: 'pol_example_7002',
    patientId: 'pat_example_1002',
    amount: '4200.00',
    status: 'DENIED',
    notes: null,
    submittedAt: '2026-10-05T10:00:00.000Z',
    approvedAt: null,
    approvedAmount: null,
    deniedAt: '2026-10-06T10:00:00.000Z',
    denyReason: 'EXAMPLE pre-existing condition not covered by the policy.',
    paidAt: null,
    version: 3,
    createdAt: STAMP,
    updatedAt: '2026-10-06T10:00:00.000Z',
  },
  {
    id: 'claim_example_5006',
    organizationId: INSURANCE_ORGANIZATION_ID,
    claimNumber: 'CLM-2026-000006',
    invoiceId: 'inv_example_8002',
    policyId: 'pol_example_7002',
    patientId: 'pat_example_1002',
    amount: '4200.00',
    status: 'APPROVED',
    notes: null,
    submittedAt: '2026-10-06T11:00:00.000Z',
    approvedAt: '2026-10-07T11:00:00.000Z',
    approvedAmount: '4200.00',
    deniedAt: null,
    denyReason: null,
    paidAt: null,
    version: 3,
    createdAt: STAMP,
    updatedAt: '2026-10-07T11:00:00.000Z',
  },
];
