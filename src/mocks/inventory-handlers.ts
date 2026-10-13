import { http, HttpResponse } from 'msw';

import { INVENTORY_BRANCH_ID, STOCK_ON_HAND } from '@/mocks/fixtures/inventory-registry';
import { MEDICATIONS } from '@/mocks/fixtures/medications-registry';
import { LIVE } from '@/mocks/prescriptions-handlers';
import { apiError, apiOk, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F6 pharmacy inventory handlers (dispensing worklist + stock control).
 *
 * Opening stock is mutable and shared by the on-hand read, the receive write and
 * the risk advisories. `POST /pharmacy/stock/dispense` decrements the branch
 * stock and advances a prescription; `POST /pharmacy/stock/receive` creates or
 * tops up a batch and grows the stock. Both answer a **bare** body
 * (`{ prescriptionStatus, dispensedLines }` / `{ batches }`) while the export
 * types the 201 as `InventoryResponseDto` (GAP-020). The advisories are derived
 * from the same stock with fixed risk thresholds — the real service computes
 * them from the ledger and batch expiries.
 */

interface DispenseLine {
  readonly medicationId: string;
  readonly quantity: number;
}

interface ReceiveLine {
  readonly medicationId: string;
  readonly quantity: number;
  readonly batchNumber: string;
  readonly expiryDate?: string;
  readonly unitCost?: number;
}

const stock = new Map<string, number>(STOCK_ON_HAND.map((row) => [row.medicationId, row.quantity]));
const expiryDays = new Map<string, number>(
  STOCK_ON_HAND.filter((row) => row.expiryInDays !== undefined).map((row) => [
    row.medicationId,
    row.expiryInDays as number,
  ]),
);
const batchIds = new Map<string, string>();
let receivedBatchSeq = 7300;
let writeOffSeq = 7400;

const LOW_STOCK_AT_OR_BELOW = 5;
const REORDER_AT_OR_BELOW = 15;

function medicationName(medicationId: string): string {
  return MEDICATIONS.find((m) => m.id === medicationId)?.name ?? medicationId;
}

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

function serializeAlerts() {
  const alerts: Array<{
    medicationId: string;
    name: string;
    label: 'LOW_STOCK' | 'REORDER_RISK' | 'EXPIRY_RISK';
    detail: string;
  }> = [];
  for (const [medicationId, quantity] of stock) {
    const name = medicationName(medicationId);
    const expiry = expiryDays.get(medicationId);
    if (expiry !== undefined && expiry <= 30) {
      alerts.push({
        medicationId,
        name,
        label: 'EXPIRY_RISK',
        detail: `Closest expiry in ${expiry} day(s).`,
      });
    }
    if (quantity <= LOW_STOCK_AT_OR_BELOW) {
      alerts.push({
        medicationId,
        name,
        label: 'LOW_STOCK',
        detail: 'Stock at or below target cover with no usage history.',
      });
    } else if (quantity <= REORDER_AT_OR_BELOW) {
      alerts.push({
        medicationId,
        name,
        label: 'REORDER_RISK',
        detail: `${(quantity / 2).toFixed(1)} day(s) of cover — order soon.`,
      });
    }
  }
  return alerts;
}

function readDispenseLines(value: unknown): readonly DispenseLine[] | null {
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

function readReceiveLines(value: unknown): readonly ReceiveLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const lines: ReceiveLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.medicationId !== 'string') return null;
    if (typeof row.batchNumber !== 'string' || row.batchNumber.trim().length === 0) return null;
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return null;
    if (row.unitCost !== undefined && row.unitCost !== null) {
      const unitCost = Number(row.unitCost);
      if (!Number.isFinite(unitCost) || unitCost < 0) return null;
    }
    lines.push({
      medicationId: row.medicationId,
      quantity,
      batchNumber: row.batchNumber.trim(),
      ...(typeof row.expiryDate === 'string' && row.expiryDate.length > 0
        ? { expiryDate: row.expiryDate }
        : {}),
      ...(row.unitCost !== undefined && row.unitCost !== null
        ? { unitCost: Number(row.unitCost) }
        : {}),
    });
  }
  return lines;
}

function batchIdFor(branchId: string, medicationId: string, batchNumber: string): string {
  const key = `${branchId}:${medicationId}:${batchNumber}`;
  const existing = batchIds.get(key);
  if (existing) return existing;
  const id = `bat_example_${receivedBatchSeq++}`;
  batchIds.set(key, id);
  return id;
}

export function inventoryHandlers() {
  return [
    http.get('*/api/v1/pharmacy/stock/on-hand', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const branchId = new URL(request.url).searchParams.get('branchId');
      const rows = serializeOnHand().filter((row) => !branchId || row.branchId === branchId);
      return HttpResponse.json(apiOk({ onHand: rows }, 'req_mock_onhand'));
    }),

    http.get('*/api/v1/pharmacy/stock/alerts', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const branchId = new URL(request.url).searchParams.get('branchId');
      const alerts = !branchId || branchId === INVENTORY_BRANCH_ID ? serializeAlerts() : [];
      return HttpResponse.json(apiOk({ alerts }, 'req_mock_alerts'));
    }),

    http.post('*/api/v1/pharmacy/stock/receive', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      const lines = readReceiveLines(body.lines);
      if (typeof body.branchId !== 'string' || lines === null) {
        return HttpResponse.json(
          apiError('VALIDATION_ERROR', 'branchId and at least one valid line are required'),
          { status: 400 },
        );
      }
      for (const line of lines) {
        if (!MEDICATIONS.find((medication) => medication.id === line.medicationId)) {
          return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Medication not found'), {
            status: 404,
          });
        }
      }
      const batches = lines.map((line) => {
        stock.set(line.medicationId, (stock.get(line.medicationId) ?? 0) + line.quantity);
        if (line.expiryDate) {
          const days = Math.ceil((Date.parse(line.expiryDate) - Date.now()) / 86_400_000);
          if (!Number.isNaN(days)) expiryDays.set(line.medicationId, days);
        }
        return {
          id: batchIdFor(body.branchId as string, line.medicationId, line.batchNumber),
          batchNumber: line.batchNumber,
          medicationId: line.medicationId,
          quantity: line.quantity,
        };
      });
      return HttpResponse.json(apiOk({ batches }, 'req_mock_receive'), { status: 201 });
    }),

    http.post('*/api/v1/pharmacy/stock/write-off', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      const lines = readDispenseLines(body.lines);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (typeof body.branchId !== 'string' || reason.length === 0 || reason.length > 500 || lines === null) {
        return HttpResponse.json(
          apiError('VALIDATION_ERROR', 'branchId, a reason and at least one valid line are required'),
          { status: 400 },
        );
      }
      for (const line of lines) {
        if (!MEDICATIONS.find((medication) => medication.id === line.medicationId)) {
          return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Medication not found'), {
            status: 404,
          });
        }
        if ((stock.get(line.medicationId) ?? 0) < line.quantity) {
          return HttpResponse.json(
            apiError('INSUFFICIENT_STOCK', `Insufficient stock of ${line.medicationId}.`),
            { status: 409 },
          );
        }
      }
      let totalQuantity = 0;
      for (const line of lines) {
        stock.set(line.medicationId, (stock.get(line.medicationId) ?? 0) - line.quantity);
        totalQuantity += line.quantity;
      }
      return HttpResponse.json(
        apiOk(
          { writeOffId: `wro_example_${writeOffSeq++}`, branchId: body.branchId, quantity: totalQuantity },
          'req_mock_writeoff',
        ),
        { status: 201 },
      );
    }),

    http.post('*/api/v1/pharmacy/stock/dispense', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      const lines = readDispenseLines(body.lines);
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
            apiError('VALIDATION_ERROR', `Cannot dispense ${line.quantity} units (${remaining} remain).`),
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
