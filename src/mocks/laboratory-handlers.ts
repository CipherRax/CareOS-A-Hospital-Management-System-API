import { http, HttpResponse } from 'msw';

import {
  LAB_ORDERS,
  LAB_SAMPLE,
  LAB_TESTS,
  type LabOrderFixture,
  type LabTestFixture,
} from '@/mocks/fixtures/laboratory-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F4 laboratory handlers (doctor results view).
 *
 * Mirrors the API split: `GET /lab/orders` serializes only the order header, the
 * sample stub and each item's `testId` — no results, no test names — while
 * `GET /lab/orders/{id}` answers the full order with named items and results.
 * `GET /lab/tests` is the catalog the results view reads to name a result's
 * field (a result carries only `testFieldId`). Same records as `e2e/stub-api.mjs`.
 */

interface LiveResult {
  id: string;
  testFieldId: string;
  value: string;
  isAbnormal: boolean;
  isCritical: boolean;
  currentVersion: number;
  amendments: number;
}

interface LiveItem {
  id: string;
  testId: string;
  testCode: string;
  testName: string;
  notes: string | null;
  results: LiveResult[];
}

interface LiveOrder {
  id: string;
  organizationId: string;
  orderNumber: string;
  patientId: string;
  branchId: string;
  encounterId: string | null;
  status: string;
  priority: string;
  clinicalNotes: string | null;
  orderedById: string | null;
  orderedAt: string | null;
  releasedById: string | null;
  releasedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  rejectionReason: string | null;
  version: number;
  sample: { id: string; sampleNumber: string; status: string } | null;
  _items: LiveItem[];
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

let itemSeq = 6200;
let resultSeq = 6300;

function buildOrder(fixture: LabOrderFixture): LiveOrder {
  const items: LiveItem[] = fixture.items.map((item) => {
    const test = LAB_TESTS.find((row) => row.id === item.testId);
    return {
      id: `loi_example_${6100 + itemSeq++}`,
      testId: item.testId,
      testCode: test?.code ?? '',
      testName: test?.name ?? '',
      notes: item.notes,
      results: item.results.map((result) => ({
        id: `lbr_example_${resultSeq++}`,
        testFieldId: result.testFieldId,
        value: result.value,
        isAbnormal: result.isAbnormal,
        isCritical: result.isCritical,
        currentVersion: 1,
        amendments: 0,
      })),
    };
  });

  return {
    id: fixture.id,
    organizationId: 'org_example_0001',
    orderNumber: fixture.orderNumber,
    patientId: fixture.patientId,
    branchId: 'br_example_0001',
    encounterId: fixture.encounterId,
    status: fixture.status,
    priority: fixture.priority,
    clinicalNotes: fixture.status === 'RELEASED' ? 'Requested during this visit.' : null,
    orderedById: 'usr_example_9001',
    orderedAt: minutesAgo(fixture.orderedMinutesAgo),
    releasedById: fixture.releasedMinutesAgo === null ? null : 'usr_example_9002',
    releasedAt: fixture.releasedMinutesAgo === null ? null : minutesAgo(fixture.releasedMinutesAgo),
    cancelledById: null,
    cancelledAt: fixture.cancelledMinutesAgo === null ? null : minutesAgo(fixture.cancelledMinutesAgo),
    cancelledReason: fixture.cancelReason,
    rejectionReason: fixture.rejectionReason,
    version: 1,
    sample: LAB_SAMPLE[fixture.id] ?? null,
    _items: items,
  };
}

const LIVE_ORDERS: LiveOrder[] = LAB_ORDERS.map(buildOrder);

function serializeSummary(order: LiveOrder) {
  const { _items, ...header } = order;
  return { ...header, items: _items.map((item) => ({ id: item.id, testId: item.testId })) };
}

function serializeDetail(order: LiveOrder) {
  const { _items, ...header } = order;
  return { ...header, items: _items };
}

function serializeTest(test: LabTestFixture) {
  return {
    id: test.id,
    organizationId: 'org_example_0001',
    code: test.code,
    name: test.name,
    categoryId: null,
    sampleType: test.sampleType,
    specimenInstructions: null,
    isActive: test.isActive,
    version: 1,
    fields: test.fields.map((field) => ({
      ...field,
      organizationId: 'org_example_0001',
      testId: test.id,
    })),
  };
}

export function laboratoryHandlers() {
  return [
    http.get('*/api/v1/lab/orders', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const patientId = url.searchParams.get('patientId');
      const branchId = url.searchParams.get('branchId');
      const status = url.searchParams.get('status');

      let rows = [...LIVE_ORDERS];
      if (patientId) rows = rows.filter((row) => row.patientId === patientId);
      if (branchId) rows = rows.filter((row) => row.branchId === branchId);
      if (status) rows = rows.filter((row) => row.status === status);
      rows.sort((a, b) => Date.parse(b.orderedAt ?? '') - Date.parse(a.orderedAt ?? ''));
      return HttpResponse.json(apiPage(rows.map(serializeSummary), rows.length, 50));
    }),

    http.get('*/api/v1/lab/orders/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = LIVE_ORDERS.find((row) => row.id === params.id);
      if (!order) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Lab order not found'), {
          status: 404,
        });
      }
      return HttpResponse.json(apiOk({ order: serializeDetail(order) }, 'req_mock_lab_order'));
    }),

    http.get('*/api/v1/lab/tests', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const active = url.searchParams.get('active');
      let tests = [...LAB_TESTS];
      if (active) tests = tests.filter((test) => test.isActive === (active === 'true'));
      return HttpResponse.json(apiPage(tests.map(serializeTest), tests.length, 100));
    }),
  ];
}
