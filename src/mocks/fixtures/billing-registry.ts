/**
 * F7 billing fixtures (invoices desk).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the production
 * build's e2e run cannot silently drift.
 *
 * Money is a decimal **string** (ADR-029), never a number. Statuses cover the
 * whole invoice lifecycle so every action branch in the workspace is reachable:
 * a draft to issue, an issued invoice to pay, a partially paid one to top up, a
 * paid one to refund, plus a cancelled and a refunded record.
 */

export interface RegistryInvoiceItem {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly referenceType: string | null;
  readonly referenceId: string | null;
}

export interface RegistryPayment {
  readonly id: string;
  readonly receiptNumber: string;
  readonly amount: string;
  readonly method: 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CHEQUE' | 'INSURANCE' | 'OTHER';
  readonly status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
  readonly externalReference: string | null;
  readonly note: string | null;
  readonly recordedAt: string;
  readonly refundedAt: string | null;
  readonly refundReason: string | null;
}

export interface RegistryInvoice {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly patientId: string;
  readonly invoiceNumber: string;
  readonly status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  readonly visitId: string | null;
  readonly encounterId: string | null;
  readonly subtotal: string;
  readonly discountAmount: string;
  readonly taxAmount: string;
  readonly total: string;
  readonly balanceDue: string;
  readonly dueAt: string | null;
  readonly notes: string | null;
  readonly issuedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly refundedAt: string | null;
  readonly refundReason: string | null;
  readonly version: number;
  readonly items: readonly RegistryInvoiceItem[];
  readonly payments: readonly RegistryPayment[];
}

export const BILLING_ORGANIZATION_ID = 'org_example_1';
export const BILLING_BRANCH_ID = 'br_example_0001';

function item(
  id: string,
  description: string,
  unitPrice: string,
  referenceType: string | null,
  referenceId: string | null,
  quantity = 1,
): RegistryInvoiceItem {
  return {
    id,
    description,
    quantity,
    unitPrice,
    lineTotal: unitPrice,
    referenceType,
    referenceId,
  };
}

export const BILLING_INVOICES: readonly RegistryInvoice[] = [
  {
    id: 'inv_example_8001',
    organizationId: BILLING_ORGANIZATION_ID,
    branchId: BILLING_BRANCH_ID,
    patientId: 'pat_example_1001',
    invoiceNumber: 'INV-2026-000001',
    status: 'ISSUED',
    visitId: 'visit_example_2001',
    encounterId: null,
    subtotal: '1500.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    total: '1500.00',
    balanceDue: '1500.00',
    dueAt: '2026-10-20T00:00:00.000Z',
    notes: 'EXAMPLE outstanding consultation fee.',
    issuedAt: '2026-10-01T09:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    refundedAt: null,
    refundReason: null,
    version: 2,
    items: [
      item('item_example_80011', 'Consultation — general', '1500.00', 'ENCOUNTER', 'enc_example_1'),
    ],
    payments: [],
  },
  {
    id: 'inv_example_8002',
    organizationId: BILLING_ORGANIZATION_ID,
    branchId: BILLING_BRANCH_ID,
    patientId: 'pat_example_1002',
    invoiceNumber: 'INV-2026-000002',
    status: 'PARTIALLY_PAID',
    visitId: 'visit_example_2002',
    encounterId: null,
    subtotal: '4200.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    total: '4200.00',
    balanceDue: '2200.00',
    dueAt: '2026-10-25T00:00:00.000Z',
    notes: null,
    issuedAt: '2026-10-02T11:30:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    refundedAt: null,
    refundReason: null,
    version: 3,
    items: [
      item('item_example_80021', 'Consultation — specialist', '1500.00', 'ENCOUNTER', 'enc_example_2'),
      item('item_example_80022', 'Laboratory — full blood count', '2700.00', 'LAB_ORDER', 'lab_example_5001'),
    ],
    payments: [
      {
        id: 'pay_example_9001',
        receiptNumber: 'RCP-2026-000101',
        amount: '2000.00',
        method: 'MOBILE_MONEY',
        status: 'COMPLETED',
        externalReference: 'MPESA-XY12',
        note: null,
        recordedAt: '2026-10-02T12:05:00.000Z',
        refundedAt: null,
        refundReason: null,
      },
    ],
  },
  {
    id: 'inv_example_8003',
    organizationId: BILLING_ORGANIZATION_ID,
    branchId: BILLING_BRANCH_ID,
    patientId: 'pat_example_1003',
    invoiceNumber: 'INV-2026-000003',
    status: 'PAID',
    visitId: null,
    encounterId: null,
    subtotal: '800.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    total: '800.00',
    balanceDue: '0.00',
    dueAt: null,
    notes: null,
    issuedAt: '2026-10-03T08:15:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    refundedAt: null,
    refundReason: null,
    version: 1,
    items: [
      item('item_example_80031', 'Pharmacy — dispensed medication', '800.00', 'PRESCRIPTION', 'rx_example_4001'),
    ],
    payments: [
      {
        id: 'pay_example_9002',
        receiptNumber: 'RCP-2026-000102',
        amount: '800.00',
        method: 'CASH',
        status: 'COMPLETED',
        externalReference: null,
        note: 'Paid at the front desk.',
        recordedAt: '2026-10-03T08:20:00.000Z',
        refundedAt: null,
        refundReason: null,
      },
    ],
  },
  {
    id: 'inv_example_8004',
    organizationId: BILLING_ORGANIZATION_ID,
    branchId: BILLING_BRANCH_ID,
    patientId: 'pat_example_1004',
    invoiceNumber: 'INV-2026-000004',
    status: 'DRAFT',
    visitId: null,
    encounterId: null,
    subtotal: '3500.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    total: '3500.00',
    balanceDue: '3500.00',
    dueAt: null,
    notes: null,
    issuedAt: null,
    cancelledAt: null,
    cancelReason: null,
    refundedAt: null,
    refundReason: null,
    version: 1,
    items: [
      item('item_example_80041', 'Procedure — wound dressing', '3500.00', 'PROCEDURE', null),
    ],
    payments: [],
  },
  {
    id: 'inv_example_8005',
    organizationId: BILLING_ORGANIZATION_ID,
    branchId: BILLING_BRANCH_ID,
    patientId: 'pat_example_1001',
    invoiceNumber: 'INV-2026-000005',
    status: 'CANCELLED',
    visitId: null,
    encounterId: null,
    subtotal: '1200.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    total: '1200.00',
    balanceDue: '0.00',
    dueAt: null,
    notes: null,
    issuedAt: '2026-10-04T10:00:00.000Z',
    cancelledAt: '2026-10-04T10:30:00.000Z',
    cancelReason: 'EXAMPLE duplicate of INV-2026-000001.',
    refundedAt: null,
    refundReason: null,
    version: 2,
    items: [
      item('item_example_80051', 'Radiology — chest X-ray', '1200.00', 'RADIOLOGY_ORDER', null),
    ],
    payments: [],
  },
  {
    id: 'inv_example_8006',
    organizationId: BILLING_ORGANIZATION_ID,
    branchId: BILLING_BRANCH_ID,
    patientId: 'pat_example_1002',
    invoiceNumber: 'INV-2026-000006',
    status: 'REFUNDED',
    visitId: null,
    encounterId: null,
    subtotal: '900.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    total: '900.00',
    balanceDue: '900.00',
    dueAt: null,
    notes: null,
    issuedAt: '2026-10-05T13:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    refundedAt: '2026-10-06T09:45:00.000Z',
    refundReason: 'EXAMPLE test cancelled after payment.',
    version: 3,
    items: [
      item('item_example_80061', 'Laboratory — malaria screen', '900.00', 'LAB_ORDER', 'lab_example_5002'),
    ],
    payments: [
      {
        id: 'pay_example_9003',
        receiptNumber: 'RCP-2026-000103',
        amount: '900.00',
        method: 'CARD',
        status: 'REFUNDED',
        externalReference: null,
        note: null,
        recordedAt: '2026-10-05T13:10:00.000Z',
        refundedAt: '2026-10-06T09:45:00.000Z',
        refundReason: 'EXAMPLE test cancelled after payment.',
      },
    ],
  },
];
