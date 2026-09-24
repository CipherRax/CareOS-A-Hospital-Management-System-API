import { ErrorCodes } from '../../../src/common/errors/codes';
import { allocateFefo, type FefoBatch } from '../../../src/modules/inventory/domain/fefo';

function batches(...rows: Array<[string, number, Date | null, FefoBatch['status']]>): FefoBatch[] {
  return rows.map(([id, onHand, expiryDate, status], i) => ({
    id,
    batchNumber: `B${i + 1}`,
    onHand,
    expiryDate,
    status,
  }));
}

const now = Date.now();
const today = new Date(now);
const in30 = new Date(now + 30 * 86_400_000);
const in60 = new Date(now + 60 * 86_400_000);
const in90 = new Date(now + 90 * 86_400_000);

describe('allocateFefo (inventory FEFO)', () => {
  it('allocates from the soonest-expiring eligible batch first', () => {
    const b = batches(
      ['a', 10, in90, 'AVAILABLE'],
      ['b', 10, in30, 'AVAILABLE'],
      ['c', 10, in60, 'AVAILABLE'],
    );
    const alloc = allocateFefo(b, 25);
    expect(alloc).toEqual([
      { batchId: 'b', batchNumber: 'B2', quantity: 10 },
      { batchId: 'c', batchNumber: 'B3', quantity: 10 },
      { batchId: 'a', batchNumber: 'B1', quantity: 5 },
    ]);
  });

  it('splits across batches and can take from a single batch', () => {
    const b = batches(['a', 50, in90, 'AVAILABLE'], ['b', 5, in30, 'AVAILABLE']);
    const alloc = allocateFefo(b, 7);
    expect(alloc).toEqual([
      { batchId: 'b', batchNumber: 'B2', quantity: 5 },
      { batchId: 'a', batchNumber: 'B1', quantity: 2 },
    ]);
    const single = allocateFefo(b, 3);
    expect(single).toEqual([{ batchId: 'b', batchNumber: 'B2', quantity: 3 }]);
  });

  it('treats expiry-null batches as last resort (freshest last)', () => {
    const b = batches(['a', 10, null, 'AVAILABLE'], ['b', 10, in60, 'AVAILABLE']);
    const alloc = allocateFefo(b, 15);
    expect(alloc).toEqual([
      { batchId: 'b', batchNumber: 'B2', quantity: 10 },
      { batchId: 'a', batchNumber: 'B1', quantity: 5 },
    ]);
  });

  it('ignores quarantined and already-expired batches for allocation', () => {
    const b = batches(
      ['a', 10, in60, 'QUARANTINED'],
      ['b', 10, today, 'AVAILABLE'], // expired today
      ['c', 10, null, 'AVAILABLE'],
    );
    const alloc = allocateFefo(b, 5);
    expect(alloc).toEqual([{ batchId: 'c', batchNumber: 'B3', quantity: 5 }]);
  });

  it('throws INSUFFICIENT_STOCK when total on-hand across all batches is short', () => {
    const b = batches(['a', 3, in60, 'AVAILABLE'], ['b', 2, in30, 'AVAILABLE']);
    try {
      allocateFefo(b, 10);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCodes.INSUFFICIENT_STOCK);
    }
  });

  it('throws MEDICATION_EXPIRED when enough total stock but not enough eligible', () => {
    const b = batches(['a', 10, today, 'AVAILABLE'], ['b', 10, in60, 'QUARANTINED']);
    try {
      allocateFefo(b, 5);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCodes.MEDICATION_EXPIRED);
    }
  });

  it('returns an empty allocation for a non-positive request', () => {
    expect(allocateFefo([], 0)).toEqual([]);
    expect(allocateFefo([], -3)).toEqual([]);
  });
});