import { http, HttpResponse } from 'msw';

import { MEDICATIONS, type MedicationFixture } from '@/mocks/fixtures/medications-registry';
import { delay, apiError, apiOk, apiPage, MOCK_LATENCY_MS } from './handlers';

/**
 * F4 medication catalog handlers (doctor workspace).
 *
 * Same contract and records as `e2e/stub-api.mjs`. The catalog is fixed (the
 * doctor workspace only reads it); the list 200 is the unwrapped envelope the
 * live interceptor produces.
 */

function serializeMedication(fixture: MedicationFixture) {
  return {
    id: fixture.id,
    organizationId: 'org_example_0001',
    category: fixture.category,
    name: fixture.name,
    genericName: fixture.genericName,
    strength: fixture.strength,
    form: fixture.form,
    unit: fixture.unit,
    sku: null,
    barcode: null,
    isControlled: fixture.isControlled,
    isActive: fixture.isActive,
    version: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  };
}

export function medicationsHandlers() {
  return [
    http.get('*/api/v1/medications', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const category = url.searchParams.get('category');
      const isActive = url.searchParams.get('isActive');
      const isControlled = url.searchParams.get('isControlled');
      const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();

      let rows = [...MEDICATIONS];
      if (category) rows = rows.filter((row) => row.category === category);
      if (isActive) rows = rows.filter((row) => row.isActive === (isActive === 'true'));
      if (isControlled) rows = rows.filter((row) => row.isControlled === (isControlled === 'true'));
      if (search) {
        rows = rows.filter((row) => `${row.name} ${row.genericName ?? ''}`.toLowerCase().includes(search));
      }
      return HttpResponse.json(apiPage(rows.map(serializeMedication), rows.length, 100));
    }),

    http.get('*/api/v1/medications/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const medication = MEDICATIONS.find((row) => row.id === params.id);
      if (!medication) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Medication not found'), {
          status: 404,
        });
      }
      return HttpResponse.json(apiOk({ medication: serializeMedication(medication) }, 'req_mock_med_get'));
    }),
  ];
}