import { http, HttpResponse } from 'msw';

import {
  PRESCRIPTIONS,
  PRESCRIPTION_BRANCH_ID,
  type PrescriptionFixture,
  type PrescriptionItemFixture,
} from '@/mocks/fixtures/prescriptions-registry';
import { MEDICATIONS } from '@/mocks/fixtures/medications-registry';
import { registryById } from '@/mocks/fixtures/patients-registry';
import { PRESCRIPTION_ACTIONS_BY_STATUS } from '@/lib/data/prescriptions';
import { delay, apiError, apiOk, apiPage, MOCK_LATENCY_MS } from './handlers';

/**
 * F4 prescription handlers (doctor workspace).
 *
 * Same contract and records as `e2e/stub-api.mjs`. The list is mutable so a
 * prescription created in the workspace appears on the patient's history. The
 * lifecycle mirrors the API domain (`prescription-flow.ts`): created DRAFT,
 * issue moves DRAFT → ISSUED, cancel is open while the drug is un- or
 * partially-dispensed, DISPENSED is terminal. Dispensing itself is a pharmacy
 * step and has no handler here.
 */

type LiveStatus = BuildPrescription['status'];

export interface LivePrescription {
  id: string;
  organizationId: string;
  branchId: string;
  patientId: string;
  providerId: string;
  status: LiveStatus;
  notes: string | null;
  issuedById: string | null;
  issuedAt: string | null;
  dispensedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  version: number;
  createdAt: string;
  _items: readonly PrescriptionItemFixture[];
}

type BuildPrescription = ReturnType<typeof fromFixture>;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function fromFixture(fixture: PrescriptionFixture) {
  return {
    id: fixture.id,
    organizationId: 'org_example_0001',
    branchId: PRESCRIPTION_BRANCH_ID,
    patientId: fixture.patientId,
    providerId: fixture.providerId,
    status: fixture.status,
    notes: fixture.notes,
    issuedById: fixture.issuedMinutesAgo === null ? null : fixture.providerId,
    issuedAt: fixture.issuedMinutesAgo === null ? null : minutesAgo(fixture.issuedMinutesAgo),
    dispensedAt: fixture.dispensedMinutesAgo === null ? null : minutesAgo(fixture.dispensedMinutesAgo),
    cancelledById: fixture.cancelledMinutesAgo === null ? null : 'usr_example_9004',
    cancelledAt: fixture.cancelledMinutesAgo === null ? null : minutesAgo(fixture.cancelledMinutesAgo),
    cancelReason: fixture.cancelReason,
    version: 1,
    createdAt: minutesAgo(fixture.createdMinutesAgo),
    _items: fixture.items.map((item) => ({ ...item })),
  };
}

// Exported so the pharmacy dispense handler (F6) can advance a prescription's
// status and item dispensed quantities against the same live store.
export const LIVE: LivePrescription[] = PRESCRIPTIONS.map(fromFixture);

export function serialize(prescription: LivePrescription) {
  // The live MediationResponse omits createdAt entirely, so the serialized row
  // mirrors the wire exactly; createdAt stays only as an internal sort key.
  const { _items, id, organizationId, branchId, patientId, providerId, status, notes, issuedById, issuedAt, dispensedAt, cancelledById, cancelledAt, cancelReason, version } = prescription;
  return {
    id,
    organizationId,
    branchId,
    patientId,
    providerId,
    status,
    notes,
    issuedById,
    issuedAt,
    dispensedAt,
    cancelledById,
    cancelledAt,
    cancelReason,
    version,
    items: _items.map((item) => ({ ...item })),
  };
}

function validateItems(value: unknown): readonly PrescriptionItemFixture[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: PrescriptionItemFixture[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.medicationId !== 'string') return null;
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return null;
    const medication = MEDICATIONS.find((m) => m.id === row.medicationId);
    if (!medication) return null;
    items.push({
      id: `pri_example_${7000 + LIVE.length * 10 + items.length + 1}`,
      medicationId: row.medicationId,
      quantity,
      dispensedQuantity: 0,
      dosage: typeof row.dosage === 'string' && row.dosage.trim().length > 0 ? row.dosage.trim() : null,
      frequency:
        typeof row.frequency === 'string' && row.frequency.trim().length > 0 ? row.frequency.trim() : null,
      durationDays: Number.isInteger(Number(row.durationDays)) ? Number(row.durationDays) : null,
      instructions:
        typeof row.instructions === 'string' && row.instructions.trim().length > 0
          ? row.instructions.trim()
          : null,
    });
  }
  return items;
}

export function prescriptionsHandlers() {
  return [
    http.get('*/api/v1/prescriptions', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const patientId = url.searchParams.get('patientId');
      const branchId = url.searchParams.get('branchId');
      const providerId = url.searchParams.get('providerId');
      const status = url.searchParams.get('status');

      let rows = [...LIVE];
      if (patientId) rows = rows.filter((row) => row.patientId === patientId);
      if (branchId) rows = rows.filter((row) => row.branchId === branchId);
      if (providerId) rows = rows.filter((row) => row.providerId === providerId);
      if (status) rows = rows.filter((row) => row.status === status);
      rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return HttpResponse.json(apiPage(rows.map(serialize), rows.length, 50));
    }),

    http.get('*/api/v1/prescriptions/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const prescription = LIVE.find((row) => row.id === params.id);
      if (!prescription) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Prescription not found'), {
          status: 404,
        });
      }
      return HttpResponse.json(apiOk({ prescription: serialize(prescription) }, 'req_mock_prx_get'));
    }),

    http.post('*/api/v1/prescriptions', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      if (typeof body.patientId !== 'string' || !registryById(body.patientId)) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Patient not found'), { status: 404 });
      }
      const items = validateItems(body.items);
      if (items === null) {
        return HttpResponse.json(
          apiError('VALIDATION_ERROR', 'At least one line item with a known medication is required'),
          { status: 400 },
        );
      }
      const now = new Date().toISOString();
      const prescription: LivePrescription = {
        id: `prx_example_${7000 + LIVE.length + 1}`,
        organizationId: 'org_example_0001',
        branchId: PRESCRIPTION_BRANCH_ID,
        patientId: body.patientId,
        providerId: 'usr_example_9001',
        status: 'DRAFT',
        notes:
          typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null,
        issuedById: null,
        issuedAt: null,
        dispensedAt: null,
        cancelledById: null,
        cancelledAt: null,
        cancelReason: null,
        version: 1,
        createdAt: now,
        _items: items,
      };
      LIVE.push(prescription);
      return HttpResponse.json(apiOk({ prescription: serialize(prescription) }, 'req_mock_prx_create'), {
        status: 201,
      });
    }),

    http.post('*/api/v1/prescriptions/:id/action', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      const prescription = LIVE.find((row) => row.id === params.id);
      if (!prescription) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Prescription not found'), {
          status: 404,
        });
      }
      const action = body.action;
      if (action !== 'issue' && action !== 'cancel') {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'action must be issue or cancel'), {
          status: 400,
        });
      }
      const allowed = PRESCRIPTION_ACTIONS_BY_STATUS[prescription.status];
      if (!allowed.includes(action)) {
        return HttpResponse.json(
          apiError(
            'INVALID_WORKFLOW_TRANSITION',
            `A ${prescription.status} prescription cannot be ${action}ed.`,
          ),
          { status: 409 },
        );
      }
      const now = new Date().toISOString();
      prescription.version += 1;
      if (action === 'issue') {
        prescription.status = 'ISSUED';
        prescription.issuedById = 'usr_example_9001';
        prescription.issuedAt = now;
      } else {
        prescription.status = 'CANCELLED';
        prescription.cancelledById = 'usr_example_9001';
        prescription.cancelledAt = now;
        prescription.cancelReason =
          typeof body.cancelReason === 'string' && body.cancelReason.trim().length > 0
            ? body.cancelReason.trim()
            : null;
      }
      return HttpResponse.json(apiOk({ prescription: serialize(prescription) }, 'req_mock_prx_action'), {
        status: 201,
      });
    }),
  ];
}