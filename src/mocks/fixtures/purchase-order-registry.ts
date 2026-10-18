/**
 * F6 procurement fixtures (purchase orders and the supplier directory).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the
 * production-build e2e report the same shelf of orders. Supplier ids are local to
 * this file; medication ids line up with `medications-registry.ts` and the branch
 * with `prescriptions-registry.ts`.
 *
 * The rows are the `serializePo` projection (what `GET /purchase-orders` actually
 * answers, not the query DTO the export fastens onto the 200). `unitCost` is a
 * decimal string because Prisma serializes `Decimal` as one (ADR-029) and the
 * reader must not be the only thing that knows that.
 */

export const PROCUREMENT_SUPPLIERS = [
  { id: 'sup_example_4001', name: 'EXAMPLE Pharma Distributors', isActive: true },
  { id: 'sup_example_4002', name: 'EXAMPLE Medical Supplies', isActive: true },
  { id: 'sup_example_4003', name: 'EXAMPLE Surgical Co.', isActive: false },
] as const;

export interface PurchaseOrderItemFixture {
  readonly id: string;
  readonly medicationId: string;
  readonly quantityOrdered: number;
  readonly quantityReceived: number;
  /** Decimal string, or null when no cost was recorded (ADR-029). */
  readonly unitCost: string | null;
}

export interface PurchaseOrderFixture {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly supplierId: string;
  readonly poNumber: string;
  readonly status: string;
  readonly expectedAt: string | null;
  readonly notes: string | null;
  readonly createdById: string;
  readonly submittedById: string | null;
  readonly approvedById: string | null;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly receivedAt: string | null;
  readonly closedAt: string | null;
  readonly version: number;
  readonly items: readonly PurchaseOrderItemFixture[];
}

/**
 * Six orders, newest first — the order the service answers (`orderBy: createdAt
 * desc`) and the order the list renders. Two share `ORDERED` so the status filter
 * has more than one row to return, and the set spans the receive workflow from an
 * untouched draft through a cancelled order so every tone on the screen is real.
 */
export const PURCHASE_ORDERS: readonly PurchaseOrderFixture[] = [
  {
    id: 'po_example_3006',
    organizationId: 'org_example_1',
    branchId: 'br_example_0001',
    supplierId: 'sup_example_4002',
    poNumber: 'PO-2026-000006',
    status: 'DRAFT',
    expectedAt: '2026-03-16T09:00:00.000Z',
    notes: null,
    createdById: 'usr_example_9001',
    submittedById: null,
    approvedById: null,
    submittedAt: null,
    approvedAt: null,
    receivedAt: null,
    closedAt: null,
    version: 1,
    items: [
      {
        id: 'poi_example_30061',
        medicationId: 'med_example_7104',
        quantityOrdered: 60,
        quantityReceived: 0,
        unitCost: '2.10',
      },
    ],
  },
  {
    id: 'po_example_3005',
    organizationId: 'org_example_1',
    branchId: 'br_example_0001',
    supplierId: 'sup_example_4003',
    poNumber: 'PO-2026-000005',
    status: 'CANCELLED',
    expectedAt: null,
    notes: 'EXAMPLE supplier could not confirm the delivery window.',
    createdById: 'usr_example_9001',
    submittedById: 'usr_example_9001',
    approvedById: null,
    submittedAt: '2026-02-24T10:00:00.000Z',
    approvedAt: null,
    receivedAt: null,
    closedAt: null,
    version: 2,
    items: [
      {
        id: 'poi_example_30051',
        medicationId: 'med_example_7105',
        quantityOrdered: 20,
        quantityReceived: 0,
        unitCost: '18.75',
      },
    ],
  },
  {
    id: 'po_example_3004',
    organizationId: 'org_example_1',
    branchId: 'br_example_0001',
    supplierId: 'sup_example_4001',
    poNumber: 'PO-2026-000004',
    status: 'RECEIVED',
    expectedAt: '2026-02-23T09:00:00.000Z',
    notes: null,
    createdById: 'usr_example_9001',
    submittedById: 'usr_example_9001',
    approvedById: 'usr_example_9001',
    submittedAt: '2026-02-16T09:30:00.000Z',
    approvedAt: '2026-02-17T07:45:00.000Z',
    receivedAt: '2026-02-23T08:20:00.000Z',
    closedAt: '2026-02-24T06:00:00.000Z',
    version: 5,
    items: [
      {
        id: 'poi_example_30041',
        medicationId: 'med_example_7102',
        quantityOrdered: 40,
        quantityReceived: 40,
        unitCost: '6.40',
      },
      {
        id: 'poi_example_30042',
        medicationId: 'med_example_7106',
        quantityOrdered: 8,
        quantityReceived: 8,
        unitCost: '22.30',
      },
    ],
  },
  {
    id: 'po_example_3003',
    organizationId: 'org_example_1',
    branchId: 'br_example_0001',
    supplierId: 'sup_example_4002',
    poNumber: 'PO-2026-000003',
    status: 'PARTIALLY_RECEIVED',
    expectedAt: '2026-02-27T09:00:00.000Z',
    notes: 'EXAMPLE back-order on the second line.',
    createdById: 'usr_example_9001',
    submittedById: 'usr_example_9001',
    approvedById: 'usr_example_9001',
    submittedAt: '2026-02-19T12:00:00.000Z',
    approvedAt: '2026-02-20T07:30:00.000Z',
    receivedAt: null,
    closedAt: null,
    version: 4,
    items: [
      {
        id: 'poi_example_30031',
        medicationId: 'med_example_7101',
        quantityOrdered: 30,
        quantityReceived: 30,
        unitCost: '12.50',
      },
      {
        id: 'poi_example_30032',
        medicationId: 'med_example_7103',
        quantityOrdered: 24,
        quantityReceived: 10,
        unitCost: '4.00',
      },
    ],
  },
  {
    id: 'po_example_3002',
    organizationId: 'org_example_1',
    branchId: 'br_example_0001',
    supplierId: 'sup_example_4002',
    poNumber: 'PO-2026-000002',
    status: 'ORDERED',
    expectedAt: '2026-03-09T09:00:00.000Z',
    notes: null,
    createdById: 'usr_example_9001',
    submittedById: 'usr_example_9001',
    approvedById: 'usr_example_9001',
    submittedAt: '2026-02-25T11:15:00.000Z',
    approvedAt: '2026-02-26T08:05:00.000Z',
    receivedAt: null,
    closedAt: null,
    version: 3,
    items: [
      {
        id: 'poi_example_30021',
        medicationId: 'med_example_7105',
        quantityOrdered: 15,
        quantityReceived: 0,
        unitCost: '18.75',
      },
    ],
  },
  {
    id: 'po_example_3001',
    organizationId: 'org_example_1',
    branchId: 'br_example_0001',
    supplierId: 'sup_example_4001',
    poNumber: 'PO-2026-000001',
    status: 'ORDERED',
    expectedAt: '2026-03-02T09:00:00.000Z',
    notes: 'EXAMPLE monthly restock.',
    createdById: 'usr_example_9001',
    submittedById: 'usr_example_9001',
    approvedById: 'usr_example_9001',
    submittedAt: '2026-02-20T11:15:00.000Z',
    approvedAt: '2026-02-21T08:05:00.000Z',
    receivedAt: null,
    closedAt: null,
    version: 3,
    items: [
      {
        id: 'poi_example_30011',
        medicationId: 'med_example_7101',
        quantityOrdered: 40,
        quantityReceived: 0,
        unitCost: '12.50',
      },
      {
        id: 'poi_example_30012',
        medicationId: 'med_example_7103',
        quantityOrdered: 12,
        quantityReceived: 0,
        unitCost: '4.00',
      },
    ],
  },
];
