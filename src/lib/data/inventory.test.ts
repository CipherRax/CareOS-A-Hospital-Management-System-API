import { describe, expect, it } from 'vitest';

import { extractStockOnHand, readDispenseResult, readStockOnHandRow } from '@/lib/data/inventory';

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
