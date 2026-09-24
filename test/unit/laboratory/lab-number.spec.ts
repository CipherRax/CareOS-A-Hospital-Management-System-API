import {
  formatLabNumber,
  LAB_COUNTER_KEYS,
} from '../../../src/modules/laboratory/domain/lab-number';
import {
  formatRadiologyNumber,
  RADIOLOGY_COUNTER_KEY,
} from '../../../src/modules/radiology/domain/radiology-number';

describe('lab-number', () => {
  it('formats the order/sample series with zero-padded sequences', () => {
    expect(formatLabNumber('order', 1)).toMatch(/^LAB-ORD-\d{4}-000001$/);
    expect(formatLabNumber('sample', 123456, 2027)).toBe('LAB-SMP-2027-123456');
    expect(formatLabNumber('order', 7)).toBe(`LAB-ORD-${new Date().getUTCFullYear()}-000007`);
  });

  it('never resets the sequence across a year rollover', () => {
    expect(formatLabNumber('order', 2, 2026)).toBe('LAB-ORD-2026-000002');
    expect(formatLabNumber('order', 3, 2027)).toBe('LAB-ORD-2027-000003');
  });

  it('keeps order and sample counters separate', () => {
    expect(LAB_COUNTER_KEYS.order).toBe('lab_order_number');
    expect(LAB_COUNTER_KEYS.sample).toBe('lab_sample_number');
  });
});

describe('radiology-number', () => {
  it('formats the RAD series with a zero-padded sequence', () => {
    expect(formatRadiologyNumber(1)).toMatch(/^RAD-\d{4}-000001$/);
    expect(formatRadiologyNumber(42, 2027)).toBe('RAD-2027-000042');
  });

  it('exposes a stable counter key', () => {
    expect(RADIOLOGY_COUNTER_KEY).toBe('radiology_order_number');
  });
});
