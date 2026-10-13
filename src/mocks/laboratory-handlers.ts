import { http, HttpResponse } from 'msw';

import {
  LAB_BRANCH_ID,
  LAB_ORDERS,
  LAB_ORDERED_BY,
  LAB_ORG_ID,
  LAB_SAMPLE,
  LAB_TESTS,
  type LabFieldFixture,
  type LabOrderFixture,
  type LabSampleFixture,
  type LabTestFixture,
} from '@/mocks/fixtures/laboratory-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F4/F5 laboratory handlers: the doctor's read view plus the lab worklist's
 * write path.
 *
 * The reads mirror the API's two projections: the list is thin (no results, no
 * test names, no criticals), the single read is full. The writes mirror the
 * server's state machine — the `LAB_ALLOWED_FROM` guards, the critical-result
 * release block, the sample stamps — against an in-memory order list, so a move
 * made in the UI is visible on the next read. Not persisted: the module resets
 * between test files and on reload.
 */

interface LiveSample {
  id: string;
  organizationId: string;
  sampleNumber: string;
  orderId: string;
  patientId: string;
  branchId: string;
  sampleType: string;
  status: string;
  collectedAt: string | null;
  receivedAt: string | null;
  processingAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
}

interface LiveResult {
  id: string;
  organizationId: string;
  orderItemId: string;
  testFieldId: string;
  currentVersion: number;
  value: string;
  isAbnormal: boolean;
  isCritical: boolean;
  amendments: number;
}

interface LiveCritical {
  id: string;
  organizationId: string;
  resultId: string;
  notifiedToId: string;
  notifiedAt: string | null;
  acknowledgedById: string | null;
  acknowledgedAt: string | null;
  escalationAt: string | null;
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
  orderedAt: string;
  releasedById: string | null;
  releasedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  rejectionReason: string | null;
  version: number;
  sample: LiveSample | null;
  _items: LiveItem[];
  criticalResults: LiveCritical[];
}

let itemSeq = 6200;
let resultSeq = 6300;
let criticalSeq = 6400;

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

/** Order status → the sample status it implies. */
function sampleStatusFor(orderStatus: string): string {
  switch (orderStatus) {
    case 'ORDERED':
      return 'ORDERED';
    case 'COLLECTED':
      return 'COLLECTED';
    case 'RECEIVED':
      return 'RECEIVED';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'REJECTED':
      return 'REJECTED';
    case 'CANCELLED':
      return 'ORDERED';
    default:
      return 'COMPLETED';
  }
}

function buildSample(
  fixture: LabSampleFixture,
  orderId: string,
  patientId: string,
  status: string,
  rejectionReason: string | null,
  base: number,
): LiveSample {
  const at = (offset: number): string | null => (base - offset >= 0 ? iso(base - offset) : null);
  const advanced = status !== 'ORDERED';
  return {
    id: fixture.id,
    organizationId: LAB_ORG_ID,
    sampleNumber: fixture.sampleNumber,
    orderId,
    patientId,
    branchId: LAB_BRANCH_ID,
    sampleType: fixture.sampleType,
    status,
    collectedAt: advanced ? at(3) : null,
    receivedAt: ['RECEIVED', 'PROCESSING', 'COMPLETED'].includes(status) ? at(6) : null,
    processingAt: ['PROCESSING', 'COMPLETED'].includes(status) ? at(9) : null,
    completedAt: status === 'COMPLETED' ? at(12) : null,
    rejectedAt: status === 'REJECTED' ? at(5) : null,
    rejectedReason: status === 'REJECTED' ? rejectionReason : null,
  };
}

function buildOrder(fixture: LabOrderFixture): LiveOrder {
  const criticalResults: LiveCritical[] = [];

  const items: LiveItem[] = fixture.items.map((item) => {
    const test = LAB_TESTS.find((row) => row.id === item.testId);
    const itemId = `loi_example_${itemSeq++}`;
    return {
      id: itemId,
      testId: item.testId,
      testCode: test?.code ?? '',
      testName: test?.name ?? '',
      notes: item.notes,
      results: item.results.map((result) => {
        const resultId = `lbr_example_${resultSeq++}`;
        if (result.isCritical) {
          const acknowledged = result.acknowledged === true;
          criticalResults.push({
            id: `lcr_example_${criticalSeq++}`,
            organizationId: LAB_ORG_ID,
            resultId,
            notifiedToId: LAB_ORDERED_BY,
            notifiedAt: iso(Math.max(fixture.orderedMinutesAgo - 1, 0)),
            acknowledgedById: acknowledged ? 'usr_example_9002' : null,
            acknowledgedAt: acknowledged ? iso(Math.max((fixture.releasedMinutesAgo ?? 1) - 1, 0)) : null,
            escalationAt: null,
          });
        }
        return {
          id: resultId,
          organizationId: LAB_ORG_ID,
          orderItemId: itemId,
          testFieldId: result.testFieldId,
          currentVersion: 1,
          value: result.value,
          isAbnormal: result.isAbnormal,
          isCritical: result.isCritical,
          amendments: 0,
        };
      }),
    };
  });

  const sampleFixture = LAB_SAMPLE[fixture.id];
  const sample = sampleFixture
    ? buildSample(
        sampleFixture,
        fixture.id,
        fixture.patientId,
        sampleStatusFor(fixture.status),
        fixture.rejectionReason,
        fixture.orderedMinutesAgo,
      )
    : null;

  return {
    id: fixture.id,
    organizationId: LAB_ORG_ID,
    orderNumber: fixture.orderNumber,
    patientId: fixture.patientId,
    branchId: LAB_BRANCH_ID,
    encounterId: fixture.encounterId,
    status: fixture.status,
    priority: fixture.priority,
    clinicalNotes: fixture.clinicalNotes ?? null,
    orderedById: LAB_ORDERED_BY,
    orderedAt: iso(fixture.orderedMinutesAgo),
    releasedById: fixture.releasedMinutesAgo === null ? null : 'usr_example_9002',
    releasedAt: fixture.releasedMinutesAgo === null ? null : iso(fixture.releasedMinutesAgo),
    cancelledById: fixture.cancelledMinutesAgo === null ? null : 'usr_example_9001',
    cancelledAt: fixture.cancelledMinutesAgo === null ? null : iso(fixture.cancelledMinutesAgo),
    cancelledReason: fixture.cancelReason,
    rejectionReason: fixture.rejectionReason,
    version: 1,
    sample,
    _items: items,
    criticalResults,
  };
}

const LIVE_ORDERS: LiveOrder[] = LAB_ORDERS.map(buildOrder);

function serializeSummary(order: LiveOrder) {
  const { _items, criticalResults, ...header } = order;
  void criticalResults;
  return { ...header, items: _items.map((item) => ({ id: item.id, testId: item.testId })) };
}

function serializeDetail(order: LiveOrder) {
  const { _items, ...header } = order;
  return { ...header, items: _items };
}

function serializeTest(test: LabTestFixture) {
  return {
    id: test.id,
    organizationId: LAB_ORG_ID,
    code: test.code,
    name: test.name,
    categoryId: null,
    sampleType: test.sampleType,
    specimenInstructions: null,
    isActive: test.isActive,
    version: 1,
    fields: test.fields.map((field) => ({
      ...field,
      organizationId: LAB_ORG_ID,
      testId: test.id,
    })),
  };
}

function findOrder(id: string | readonly string[] | undefined): LiveOrder | undefined {
  const key = Array.isArray(id) ? id[0] : id;
  return LIVE_ORDERS.find((row) => row.id === key);
}

function notFound(message: string) {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
}

function conflict(message: string, code = 'INVALID_WORKFLOW_TRANSITION') {
  return HttpResponse.json(apiError(code, message), { status: 409 });
}

function orderResponse(order: LiveOrder) {
  return HttpResponse.json(apiOk({ order: serializeDetail(order) }, 'req_mock_lab'));
}

/** Mirrors the server's numeric threshold classification. */
function classify(
  field: LabFieldFixture,
  value: string,
): { isAbnormal: boolean; isCritical: boolean } {
  if (field.fieldType !== 'NUMERIC') return { isAbnormal: false, isCritical: false };
  const n = Number(value);
  if (!Number.isFinite(n)) return { isAbnormal: false, isCritical: false };
  const below = (bound: string | null) => bound !== null && n < Number(bound);
  const above = (bound: string | null) => bound !== null && n > Number(bound);
  const isCritical = below(field.criticalMin) || above(field.criticalMax);
  const isAbnormal = isCritical || below(field.referenceMin) || above(field.referenceMax);
  return { isAbnormal, isCritical };
}

function fieldIndex(): Map<string, { testId: string; field: LabFieldFixture }> {
  const index = new Map<string, { testId: string; field: LabFieldFixture }>();
  for (const test of LAB_TESTS) {
    for (const field of test.fields) index.set(field.id, { testId: test.id, field });
  }
  return index;
}

function advanceSample(order: LiveOrder, nextStatus: string, extra: Partial<LiveSample> = {}) {
  if (!order.sample) return;
  order.sample.status = sampleStatusFor(nextStatus);
  Object.assign(order.sample, extra);
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
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      return HttpResponse.json(apiOk({ order: serializeDetail(order) }, 'req_mock_lab_order'));
    }),

    http.post('*/api/v1/lab/orders/:id/collect', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (order.status !== 'ORDERED') return conflict('Only an ordered sample can be collected.');
      order.status = 'COLLECTED';
      advanceSample(order, 'COLLECTED', { collectedAt: new Date().toISOString() });
      return orderResponse(order);
    }),

    http.post('*/api/v1/lab/orders/:id/receive', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (order.status !== 'COLLECTED') return conflict('Only a collected sample can be received.');
      order.status = 'RECEIVED';
      advanceSample(order, 'RECEIVED', { receivedAt: new Date().toISOString() });
      return orderResponse(order);
    }),

    http.post('*/api/v1/lab/orders/:id/process', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (order.status !== 'RECEIVED') return conflict('Only a received sample can be processed.');
      order.status = 'PROCESSING';
      advanceSample(order, 'PROCESSING', { processingAt: new Date().toISOString() });
      return orderResponse(order);
    }),

    http.post('*/api/v1/lab/orders/:id/reject', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (!['COLLECTED', 'RECEIVED'].includes(order.status)) {
        return conflict('Only a collected or received sample can be rejected.');
      }
      const body = (await request.json()) as { reason?: string };
      const reason = body.reason ?? '';
      order.status = 'REJECTED';
      order.rejectionReason = reason;
      advanceSample(order, 'REJECTED', {
        rejectedAt: new Date().toISOString(),
        rejectedReason: reason,
      });
      return orderResponse(order);
    }),

    http.post('*/api/v1/lab/orders/:id/cancel', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (!['ORDERED', 'COLLECTED'].includes(order.status)) {
        return conflict('This order can no longer be cancelled.');
      }
      const body = (await request.json()) as { reason?: string };
      order.status = 'CANCELLED';
      order.cancelledAt = new Date().toISOString();
      order.cancelledById = 'usr_example_9001';
      order.cancelledReason = body.reason ?? '';
      advanceSample(order, 'CANCELLED');
      return orderResponse(order);
    }),

    http.post('*/api/v1/lab/orders/:id/results', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (order.status !== 'PROCESSING') {
        return conflict('Results can only be entered for an order in progress.');
      }
      const body = (await request.json()) as {
        comments?: string;
        results?: readonly { testFieldId?: string; value?: string }[];
      };

      for (const submitted of body.results ?? []) {
        const fieldId = submitted.testFieldId;
        if (!fieldId) continue;
        const entry = fieldIndex().get(fieldId);
        if (!entry) return conflict('A result points at a field this order does not carry.');
        const item = order._items.find((row) =>
          LAB_TESTS.find((test) => test.id === row.testId)?.fields.some((f) => f.id === fieldId),
        );
        if (!item) continue;
        const value = submitted.value ?? '';
        const flags = classify(entry.field, value);
        const resultId = `lbr_example_${resultSeq++}`;
        item.results.push({
          id: resultId,
          organizationId: LAB_ORG_ID,
          orderItemId: item.id,
          testFieldId: fieldId,
          currentVersion: 1,
          value,
          isAbnormal: flags.isAbnormal,
          isCritical: flags.isCritical,
          amendments: 0,
        });
        if (flags.isCritical) {
          order.criticalResults.push({
            id: `lcr_example_${criticalSeq++}`,
            organizationId: LAB_ORG_ID,
            resultId,
            notifiedToId: order.orderedById ?? LAB_ORDERED_BY,
            notifiedAt: new Date().toISOString(),
            acknowledgedById: null,
            acknowledgedAt: null,
            escalationAt: null,
          });
        }
      }
      order.status = 'RESULT_READY';
      advanceSample(order, 'RESULT_READY', { completedAt: new Date().toISOString() });
      return orderResponse(order);
    }),

    http.post('*/api/v1/lab/orders/:id/verify', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (order.status !== 'RESULT_READY') return conflict('Only a result-ready order can be verified.');
      order.status = 'VERIFIED';
      return orderResponse(order);
    }),

    http.post('*/api/v1/lab/orders/:id/release', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Lab order not found');
      if (order.status !== 'VERIFIED') return conflict('Only a verified order can be released.');
      if (order.criticalResults.some((critical) => critical.acknowledgedAt === null)) {
        return conflict(
          'Critical results on this order have not been acknowledged yet.',
          'LAB_RESULT_NOT_ACKNOWLEDGED',
        );
      }
      order.status = 'RELEASED';
      order.releasedAt = new Date().toISOString();
      order.releasedById = 'usr_example_9002';
      return orderResponse(order);
    }),

    http.patch('*/api/v1/lab/results/:id', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = (await request.json()) as { value?: string; reason?: string };
      for (const order of LIVE_ORDERS) {
        for (const item of order._items) {
          const result = item.results.find((row) => row.id === params.id);
          if (result) {
            const entry = fieldIndex().get(result.testFieldId);
            const flags = entry
              ? classify(entry.field, body.value ?? result.value)
              : { isAbnormal: false, isCritical: false };
            result.value = body.value ?? result.value;
            result.isAbnormal = flags.isAbnormal;
            result.isCritical = flags.isCritical;
            result.currentVersion += 1;
            result.amendments += 1;
            return HttpResponse.json(apiOk({ result }, 'req_mock_lab_amend'));
          }
        }
      }
      return notFound('Result not found');
    }),

    http.post('*/api/v1/lab/critical/:id/acknowledge', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = (await request.json()) as { note?: string };
      for (const order of LIVE_ORDERS) {
        const critical = order.criticalResults.find((row) => row.id === params.id);
        if (critical) {
          if (!critical.acknowledgedAt) {
            critical.acknowledgedById = 'usr_example_9002';
            critical.acknowledgedAt = new Date().toISOString();
            critical.escalationAt = body.note ? null : critical.escalationAt;
          }
          return HttpResponse.json(
            apiOk({ criticalResult: critical }, 'req_mock_lab_critical'),
          );
        }
      }
      return notFound('Critical result not found');
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
