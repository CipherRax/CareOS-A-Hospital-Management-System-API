import { http, HttpResponse } from 'msw';

import {
  RADIOLOGY_BRANCH_ID,
  RADIOLOGY_ORDERS,
  RADIOLOGY_ORDERED_BY,
  RADIOLOGY_ORG_ID,
  RADIOLOGY_PERFORMED_BY,
  RADIOLOGY_RELEASED_BY,
  type RadiologyOrderFixture,
} from '@/mocks/fixtures/radiology-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F4/F5 radiology handlers: the doctor's read view plus the radiology worklist's
 * write path.
 *
 * The list serializes the full order including its report, so it alone backs the
 * doctor's imaging results. The writes mirror the server's state machine — the
 * `RAD_ALLOWED_FROM` guards and the report/verify/release ordering — against an
 * in-memory order list, so a move made in the UI is visible on the next read.
 * Not persisted: the module resets between test files and on reload.
 */

interface LiveReport {
  id: string;
  organizationId: string;
  orderId: string;
  findings: string | null;
  summary: string | null;
  impression: string | null;
  enteredById: string | null;
  enteredAt: string | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  version: number;
}

interface LiveOrder {
  id: string;
  organizationId: string;
  orderNumber: string;
  patientId: string;
  branchId: string;
  encounterId: string | null;
  modality: string;
  region: string | null;
  status: string;
  clinicalNotes: string | null;
  orderedById: string | null;
  orderedAt: string;
  requestedAt: string | null;
  performedById: string | null;
  performedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  releasedById: string | null;
  releasedAt: string | null;
  version: number;
  report: LiveReport | null;
}

let reportSeq = 4100;

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function buildOrder(fixture: RadiologyOrderFixture): LiveOrder {
  return {
    id: fixture.id,
    organizationId: RADIOLOGY_ORG_ID,
    orderNumber: fixture.orderNumber,
    patientId: fixture.patientId,
    branchId: RADIOLOGY_BRANCH_ID,
    encounterId: fixture.encounterId,
    modality: fixture.modality,
    region: fixture.region,
    status: fixture.status,
    clinicalNotes: fixture.clinicalNotes,
    orderedById: RADIOLOGY_ORDERED_BY,
    orderedAt: iso(fixture.orderedMinutesAgo),
    requestedAt:
      fixture.requestedMinutesAgo === null ? null : iso(fixture.requestedMinutesAgo),
    performedById: fixture.performedMinutesAgo === null ? null : RADIOLOGY_PERFORMED_BY,
    performedAt:
      fixture.performedMinutesAgo === null ? null : iso(fixture.performedMinutesAgo),
    cancelledById: fixture.cancelledMinutesAgo === null ? null : RADIOLOGY_ORDERED_BY,
    cancelledAt:
      fixture.cancelledMinutesAgo === null ? null : iso(fixture.cancelledMinutesAgo),
    cancelledReason: fixture.cancelReason,
    releasedById: fixture.releasedMinutesAgo === null ? null : RADIOLOGY_RELEASED_BY,
    releasedAt:
      fixture.releasedMinutesAgo === null ? null : iso(fixture.releasedMinutesAgo),
    version: 1,
    report: fixture.report
      ? {
          id: fixture.report.id,
          organizationId: RADIOLOGY_ORG_ID,
          orderId: fixture.id,
          findings: fixture.report.findings,
          summary: fixture.report.summary,
          impression: fixture.report.impression,
          enteredById: fixture.report.enteredMinutesAgo === null ? null : RADIOLOGY_PERFORMED_BY,
          enteredAt:
            fixture.report.enteredMinutesAgo === null
              ? null
              : iso(fixture.report.enteredMinutesAgo),
          verifiedById: fixture.report.verifiedMinutesAgo === null ? null : RADIOLOGY_RELEASED_BY,
          verifiedAt:
            fixture.report.verifiedMinutesAgo === null
              ? null
              : iso(fixture.report.verifiedMinutesAgo),
          version: 1,
        }
      : null,
  };
}

const LIVE_ORDERS: LiveOrder[] = RADIOLOGY_ORDERS.map(buildOrder);

function findOrder(id: string | readonly string[] | undefined): LiveOrder | undefined {
  const key = Array.isArray(id) ? id[0] : id;
  return LIVE_ORDERS.find((row) => row.id === key);
}

function notFound(message: string) {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
}

function conflict(message: string) {
  return HttpResponse.json(apiError('INVALID_WORKFLOW_TRANSITION', message), { status: 409 });
}

function orderResponse(order: LiveOrder) {
  return HttpResponse.json(apiOk({ order }, 'req_mock_radiology'));
}

export function radiologyHandlers() {
  return [
    http.get('*/api/v1/radiology/orders', async ({ request }) => {
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
      return HttpResponse.json(apiPage(rows, rows.length, 50));
    }),

    http.get('*/api/v1/radiology/orders/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Radiology order not found');
      return HttpResponse.json(apiOk({ order }, 'req_mock_radiology_order'));
    }),

    http.post('*/api/v1/radiology/orders/:id/schedule', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Radiology order not found');
      if (order.status !== 'ORDERED') return conflict('Only an ordered study can be scheduled.');
      order.status = 'SCHEDULED';
      order.requestedAt = new Date().toISOString();
      return orderResponse(order);
    }),

    http.post('*/api/v1/radiology/orders/:id/perform', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Radiology order not found');
      if (order.status !== 'SCHEDULED') return conflict('Only a scheduled study can be performed.');
      order.status = 'PERFORMED';
      order.performedAt = new Date().toISOString();
      order.performedById = RADIOLOGY_PERFORMED_BY;
      return orderResponse(order);
    }),

    http.post('*/api/v1/radiology/orders/:id/report', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Radiology order not found');
      if (order.status !== 'PERFORMED') return conflict('Only a performed study can be reported.');
      const body = (await request.json()) as {
        findings?: string;
        summary?: string;
        impression?: string;
      };
      order.status = 'REPORTED';
      order.report = {
        id: `imr_example_${reportSeq++}`,
        organizationId: RADIOLOGY_ORG_ID,
        orderId: order.id,
        findings: body.findings ?? null,
        summary: body.summary ?? null,
        impression: body.impression ?? null,
        enteredById: RADIOLOGY_PERFORMED_BY,
        enteredAt: new Date().toISOString(),
        verifiedById: null,
        verifiedAt: null,
        version: 1,
      };
      return orderResponse(order);
    }),

    http.post('*/api/v1/radiology/orders/:id/verify', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Radiology order not found');
      if (order.status !== 'REPORTED') return conflict('Only a reported study can be verified.');
      order.status = 'VERIFIED';
      if (order.report) {
        order.report.verifiedById = RADIOLOGY_RELEASED_BY;
        order.report.verifiedAt = new Date().toISOString();
      }
      return orderResponse(order);
    }),

    http.post('*/api/v1/radiology/orders/:id/release', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Radiology order not found');
      if (order.status !== 'VERIFIED') return conflict('Only a verified study can be released.');
      order.status = 'RELEASED';
      order.releasedAt = new Date().toISOString();
      order.releasedById = RADIOLOGY_RELEASED_BY;
      return orderResponse(order);
    }),

    http.post('*/api/v1/radiology/orders/:id/cancel', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const order = findOrder(params.id);
      if (!order) return notFound('Radiology order not found');
      if (!['ORDERED', 'SCHEDULED'].includes(order.status)) {
        return conflict('This study can no longer be cancelled.');
      }
      const body = (await request.json()) as { reason?: string };
      order.status = 'CANCELLED';
      order.cancelledAt = new Date().toISOString();
      order.cancelledById = RADIOLOGY_ORDERED_BY;
      order.cancelledReason = body.reason ?? '';
      return orderResponse(order);
    }),
  ];
}
