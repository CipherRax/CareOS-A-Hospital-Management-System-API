import { http, HttpResponse } from 'msw';

import { RADIOLOGY_ORDERS, type RadiologyOrderFixture } from '@/mocks/fixtures/radiology-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F4 radiology handlers (doctor results view).
 *
 * The imaging list serializes the full order *with* its report, so the list read
 * alone backs the doctor's imaging results — there is no follow-up fetch. Write
 * moves (schedule, perform, report, verify, release) belong to the radiology
 * department and are out of this view's scope.
 */

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function serializeOrder(fixture: RadiologyOrderFixture) {
  return {
    id: fixture.id,
    organizationId: 'org_example_0001',
    orderNumber: fixture.orderNumber,
    patientId: fixture.patientId,
    branchId: 'br_example_0001',
    encounterId: fixture.encounterId,
    modality: fixture.modality,
    region: fixture.region,
    status: fixture.status,
    clinicalNotes: fixture.clinicalNotes,
    orderedById: 'usr_example_9001',
    orderedAt: minutesAgo(fixture.orderedMinutesAgo),
    requestedAt:
      fixture.status === 'SCHEDULED' ? minutesAgo(Math.max(0, fixture.orderedMinutesAgo - 2)) : null,
    performedById: fixture.performedMinutesAgo === null ? null : 'usr_example_9002',
    performedAt:
      fixture.performedMinutesAgo === null ? null : minutesAgo(fixture.performedMinutesAgo),
    cancelledById: null,
    cancelledAt: null,
    cancelledReason: null,
    releasedById: fixture.releasedMinutesAgo === null ? null : 'usr_example_9003',
    releasedAt: fixture.releasedMinutesAgo === null ? null : minutesAgo(fixture.releasedMinutesAgo),
    version: 1,
    report: fixture.report
      ? {
          id: fixture.report.id,
          organizationId: 'org_example_0001',
          orderId: fixture.id,
          findings: fixture.report.findings,
          summary: fixture.report.summary,
          impression: fixture.report.impression,
          enteredById: fixture.report.enteredMinutesAgo === null ? null : 'usr_example_9002',
          enteredAt:
            fixture.report.enteredMinutesAgo === null
              ? null
              : minutesAgo(fixture.report.enteredMinutesAgo),
          verifiedById: fixture.report.verifiedMinutesAgo === null ? null : 'usr_example_9003',
          verifiedAt:
            fixture.report.verifiedMinutesAgo === null
              ? null
              : minutesAgo(fixture.report.verifiedMinutesAgo),
          version: 1,
        }
      : null,
  };
}

const LIVE = RADIOLOGY_ORDERS.map(serializeOrder);

export function radiologyHandlers() {
  return [
    http.get('*/api/v1/radiology/orders', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const patientId = url.searchParams.get('patientId');
      const branchId = url.searchParams.get('branchId');
      const status = url.searchParams.get('status');

      let rows = [...LIVE];
      if (patientId) rows = rows.filter((row) => row.patientId === patientId);
      if (branchId) rows = rows.filter((row) => row.branchId === branchId);
      if (status) rows = rows.filter((row) => row.status === status);
      rows.sort((a, b) => Date.parse(b.orderedAt ?? '') - Date.parse(a.orderedAt ?? ''));
      return HttpResponse.json(apiPage(rows, rows.length, 50));
    }),

    http.get('*/api/v1/radiology/orders/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const order = LIVE.find((row) => row.id === params.id);
      if (!order) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Radiology order not found'), {
          status: 404,
        });
      }
      return HttpResponse.json(apiOk({ order }, 'req_mock_radiology_order'));
    }),
  ];
}
