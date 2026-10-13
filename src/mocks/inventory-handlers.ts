import { http, HttpResponse } from 'msw';

import {
  INVENTORY_BRANCH_ID,
  STOCK_ON_HAND,
} from '@/mocks/fixtures/inventory-registry';
import { MEDICATIONS } from '@/mocks/fixtures/medications-registry';
import { LIVE } from '@/mocks/prescriptions-handlers';
import { apiError, apiOk, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F6 pharmacy inventory handlers (dispensing worklist).
 *
 * Opening stock is mutable and shared by the on-hand read and the dispense
 * write. `POST /pharmacy/stock/dispense` decrements the branch stock, advances
 * the prescription items' dispensed quantities and derives the new status from
 * the cumulative totals, then answers the bare `{ prescriptionStatus,
 * dispensedLines }` the live service returns (GAP-020). The real FEFO allocation
 * across batches is a DB concern and is not simulated here.
 */

interface DispenseLine {
  readonly medicationId: string;
  readonly quantity: number;
}

const stock = new Map<string, number>(
  STOCK_ON_HAND.map((row) => [row.medicationId, row.quantity]),
);

function serializeOnHand() {
  return [...stock].map(([medicationId, quantity]) => {
    const medication = MEDICATIONS.find((m) => m.id === medicationId);
    return {
      medicationId,
      name: medication?.name ?? null,
      unit: medication?.unit ?? null,
      branchId: INVENTORY_BRANCH_ID,
      quantity,
    };
  });
}

function readLines(value: unknown): readonly DispenseLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const lines: DispenseLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.medicationId !== 'string') return null;
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return null;
    lines.push({ medicationId: row.medicationId, quantity });
  }
  return lines;
}

export function inventoryHandlers() {
  return [
    http.get('*/api/v1/pharmacy/stock/on-hand', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const branchId = new URL(request.url).searchParams.get('branchId');
      const rows = serializeOnHand().filter((row) => !branchId || row.branchId === branchId);
      return HttpResponse.json(apiOk({ onHand: rows }, 'req_mock_onhand'));
    }),

    http.post('*/api/v1/pharmacy/stock/dispense', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      const lines = readLines(body.lines);
      if (
        typeof body.prescriptionId !== 'string' ||
        typeof body.branchId !== 'string' ||
        lines === null
      ) {
        return HttpResponse.json(
          apiError('VALIDATION_ERROR', 'prescriptionId, branchId and at least one line are required'),
          { status: 400 },
        );
      }
      const prescription = LIVE.find((row) => row.id === body.prescriptionId);
      if (!prescription) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Prescription not found'), {
          status: 404,
        });
      }
      const status = prescription.status;
      if (status !== 'ISSUED' && status !== 'PARTIALLY_DISPENSED') {
        return HttpResponse.json(
          apiError('INVALID_WORKFLOW_TRANSITION', `A ${status} prescription cannot be dispensed.`),
          { status: 409 },
        );
      }
      if (prescription.branchId !== body.branchId) {
        return HttpResponse.json(
          apiError('INSUFFICIENT_STOCK', 'Dispensing cannot happen at another branch.'),
          { status: 409 },
        );
      }

      const byMedication = new Map(prescription._items.map((item) => [item.medicationId, item]));
      for (const line of lines) {
        const item = byMedication.get(line.medicationId);
        if (!item) {
          return HttpResponse.json(
            apiError('RESOURCE_NOT_FOUND', 'Medication is not on this prescription'),
            { status: 404 },
          );
        }
        const remaining = item.quantity - item.dispensedQuantity;
        if (line.quantity > remaining) {
          return HttpResponse.json(
            apiError(
              'VALIDATION_ERROR',
              `Cannot dispense ${line.quantity} units (${remaining} remain).`,
            ),
            { status: 400 },
          );
        }
        if ((stock.get(line.medicationId) ?? 0) < line.quantity) {
          return HttpResponse.json(
            apiError('INSUFFICIENT_STOCK', `Insufficient stock of ${line.medicationId}.`),
            { status: 409 },
          );
        }
      }

      for (const line of lines) {
        stock.set(line.medicationId, (stock.get(line.medicationId) ?? 0) - line.quantity);
      }
      prescription._items = prescription._items.map((item) => {
        const line = lines.find((entry) => entry.medicationId === item.medicationId);
        if (!line) return item;
        return { ...item, dispensedQuantity: item.dispensedQuantity + line.quantity };
      });

      const totalRequested = prescription._items.reduce((sum, item) => sum + item.quantity, 0);
      const totalDispensed = prescription._items.reduce((sum, item) => sum + item.dispensedQuantity, 0);
      const next = totalDispensed >= totalRequested ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
      prescription.status = next;
      prescription.version += 1;
      if (next === 'DISPENSED') prescription.dispensedAt = new Date().toISOString();

      return HttpResponse.json(
        apiOk(
          { prescriptionStatus: next, dispensedLines: lines.map((line) => line.medicationId) },
          'req_mock_dispense',
        ),
        { status: 201 },
      );
    }),
  ];
}
