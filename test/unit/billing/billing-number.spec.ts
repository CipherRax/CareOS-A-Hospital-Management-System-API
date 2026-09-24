import { formatBillingNumber } from '../../../src/modules/billing/domain/billing-number';

describe('billing-number', () => {
  it('formats INV/RCT/CLM series with org-stable counters', () => {
    expect(formatBillingNumber('invoice', 1)).toMatch(/^INV-\d{4}-000001$/);
    expect(formatBillingNumber('receipt', 123456, 2027)).toBe('RCT-2027-123456');
    expect(formatBillingNumber('claim', 7)).toBe(`CLM-${new Date().getUTCFullYear()}-000007`);
  });

  it('pads and never resets across year rollover', () => {
    expect(formatBillingNumber('invoice', 2, 2026)).toBe('INV-2026-000002');
    expect(formatBillingNumber('invoice', 3, 2027)).toBe('INV-2027-000003');
  });
});