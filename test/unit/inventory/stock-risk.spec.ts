import {
  assessStockRisk,
  avgDailyUsage,
  computeOnHand,
  consumptionSince,
} from '../../../src/modules/inventory/domain/stock-risk';

const minutes = 60_000;
const days = (n: number) => n * 24 * 60 * minutes;

describe('stock-risk ledger analytics', () => {
  it('computes net on-hand from signed ledger lines', () => {
    const fiveMinutesAgo = Date.now() - 5 * minutes;
    const lines = [
      { operation: 'RECEIVED' as const, quantity: 100, occurredAt: new Date(Date.now() - days(10)) },
      { operation: 'DISPENSED' as const, quantity: -30, occurredAt: new Date(Date.now() - days(2)) },
      { operation: 'TRANSFER_IN' as const, quantity: 10, occurredAt: new Date(Date.now() - days(1)) },
      { operation: 'WASTAGE' as const, quantity: -5, occurredAt: new Date(fiveMinutesAgo) },
    ];
    expect(computeOnHand(lines)).toBe(75);
  });

  it('counts only outbound movement over the window', () => {
    const nowMs = Date.now();
    const lines = [
      { operation: 'DISPENSED' as const, quantity: -40, occurredAt: new Date(nowMs - days(3)) },
      { operation: 'TRANSFER_OUT' as const, quantity: -10, occurredAt: new Date(nowMs - days(1)) },
      { operation: 'RECEIVED' as const, quantity: 500, occurredAt: new Date(nowMs - days(60)) },
      { operation: 'WASTAGE' as const, quantity: -5, occurredAt: new Date(nowMs - days(5)) },
    ];
    expect(consumptionSince(lines, 7)).toBe(55);
    expect(avgDailyUsage(lines, 7)).toBeCloseTo(55 / 7, 5);
  });

  it('ignores consumption older than the window', () => {
    const nowMs = Date.now();
    const lines = [
      { operation: 'DISPENSED' as const, quantity: -100, occurredAt: new Date(nowMs - days(30)) },
      { operation: 'DISPENSED' as const, quantity: -20, occurredAt: new Date(nowMs - days(1)) },
    ];
    expect(consumptionSince(lines, 7)).toBe(20);
  });
});

describe('assessStockRisk', () => {
  it('expiry risk outranks reorder risk', () => {
    const tier = assessStockRisk({
      onHand: 100,
      usagePerDay: 5,
      targetDays: 7,
      daysToExpiry: [45, null],
    });
    expect(tier.label).toBe('EXPIRY_RISK');
    expect(tier.label === 'EXPIRY_RISK' && tier.closestExpiryDays).toBe(45);
  });

  it('flags LOW_STOCK when cover is at/below half the target', () => {
    const tier = assessStockRisk({
      onHand: 10,
      usagePerDay: 5, // 2 days of cover
      targetDays: 7,
      daysToExpiry: [null],
    });
    expect(tier.label).toBe('LOW_STOCK');
  });

  it('flags REORDER_RISK when cover is within the target window', () => {
    const tier = assessStockRisk({
      onHand: 28,
      usagePerDay: 5, // 5.6 days of cover
      targetDays: 7,
      daysToExpiry: [null],
    });
    expect(tier.label).toBe('REORDER_RISK');
  });

  it('reports OK when cover comfortably exceeds the target', () => {
    const tier = assessStockRisk({
      onHand: 100,
      usagePerDay: 2, // 50 days of cover
      targetDays: 7,
      daysToExpiry: [200],
    });
    expect(tier.label).toBe('OK');
  });

  it('falls back to a low-stock signal without consumption history', () => {
    const tier = assessStockRisk({
      onHand: 2,
      usagePerDay: 0,
      targetDays: 7,
      daysToExpiry: [null],
    });
    expect(tier.label).toBe('LOW_STOCK');
  });
});