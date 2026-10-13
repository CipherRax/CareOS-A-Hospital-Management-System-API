import { describe, expect, it } from 'vitest';

import {
  extractStockAlerts,
  extractStockOnHand,
  readDispenseResult,
  readReceiveResult,
  readStockAlertRow,
  readStockOnHandRow,
} from '@/lib/data/inventory';

/**
 * F6 pharmacy inventory data layer.
 *
 * The on-hand read carries `query: never` and a request-DTO 200 while the service
 * answers `{ onHand: [...] }` (GAP-020), and the dispense write answers a bare
 * `{ prescriptionStatus, dispensedLines }` while the export types the 201 as
 * `InventoryResponseDto`. Both are validated structurally here.
 */

const row = {
  medicationId: 'med_example_7101',
  name: 'EXAMPLE Amoxicillin',
  unit: 'capsule',
  branchId: 'br_example_0001',
  quantity: 30,
};

describe('readStockOnHandRow', () => {
  it('reads a full row', () => {
    const parsed = readStockOnHandRow(row);
    expect(parsed?.medicationId).toBe('med_example_7101');
    expect(parsed?.quantity).toBe(30);
  });

  it('tolerates missing name and unit but requires id, branch and quantity', () => {
    const parsed = readStockOnHandRow({ ...row, name: undefined, unit: null });
    expect(parsed?.name).toBeNull();
    expect(parsed?.unit).toBeNull();
    expect(readStockOnHandRow({ ...row, medicationId: undefined })).toBeNull();
    expect(readStockOnHandRow({ ...row, branchId: undefined })).toBeNull();
    expect(readStockOnHandRow({ ...row, quantity: '30' })).toBeNull();
    expect(readStockOnHandRow(null)).toBeNull();
  });
});

describe('extractStockOnHand', () => {
  it('reads the { onHand } body', () => {
    const parsed = extractStockOnHand({ onHand: [row] });
    expect(parsed.ok && parsed.rows[0]?.quantity).toBe(30);
  });

  it('accepts an empty list and fails closed on a broken body', () => {
    expect(extractStockOnHand({ onHand: [] }).ok && true).toBe(true);
    expect(extractStockOnHand({})).toEqual({ ok: false });
    expect(extractStockOnHand({ onHand: [{}] })).toEqual({ ok: false });
    expect(extractStockOnHand(null)).toEqual({ ok: false });
  });
});

describe('readDispenseResult', () => {
  it('reads the bare dispense body', () => {
    const parsed = readDispenseResult({
      prescriptionStatus: 'PARTIALLY_DISPENSED',
      dispensedLines: ['med_example_7101'],
    });
    expect(parsed.ok && parsed.result.prescriptionStatus).toBe('PARTIALLY_DISPENSED');
    expect(parsed.ok && parsed.result.dispensedLines).toEqual(['med_example_7101']);
  });

  it('fails closed when the body drifts', () => {
    expect(readDispenseResult({ dispensedLines: [] })).toEqual({ ok: false });
    expect(readDispenseResult({ prescriptionStatus: 'DISPENSED', dispensedLines: [1] })).toEqual({
      ok: false,
    });
    expect(readDispenseResult(null)).toEqual({ ok: false });
  });
});

const alert = {
  medicationId: 'med_example_7105',
  name: 'EXAMPLE Morphine (controlled)',
  label: 'LOW_STOCK',
  detail: 'Stock at or below target cover with no usage history.',
};

describe('readStockAlertRow', () => {
  it('reads a known tier and rejects an unknown label', () => {
    expect(readStockAlertRow(alert)?.label).toBe('LOW_STOCK');
    expect(readStockAlertRow({ ...alert, label: 'NOPE' })).toBeNull();
    expect(readStockAlertRow({ ...alert, detail: undefined })).toBeNull();
  });
});

describe('extractStockAlerts', () => {
  it('reads the { alerts } body and fails closed on drift', () => {
    const parsed = extractStockAlerts({ alerts: [alert] });
    expect(parsed.ok && parsed.alerts[0]?.label).toBe('LOW_STOCK');
    expect(extractStockAlerts({ alerts: [] }).ok && true).toBe(true);
    expect(extractStockAlerts({})).toEqual({ ok: false });
    expect(extractStockAlerts({ alerts: [{}] })).toEqual({ ok: false });
  });
});

describe('readReceiveResult', () => {
  it('reads the { batches } body', () => {
    const parsed = readReceiveResult({
      batches: [
        { id: 'bat_example_7300', batchNumber: 'LOT-1', medicationId: 'med_example_7101', quantity: 50 },
      ],
    });
    expect(parsed.ok && parsed.batches[0]?.batchNumber).toBe('LOT-1');
  });

  it('fails closed when a batch row drifts', () => {
    expect(readReceiveResult({ batches: [{}] })).toEqual({ ok: false });
    expect(readReceiveResult({})).toEqual({ ok: false });
    expect(readReceiveResult(null)).toEqual({ ok: false });
  });
});
