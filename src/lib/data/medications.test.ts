import { describe, expect, it } from 'vitest';

import {
  extractMedicationPage,
  extractMedicationRecord,
  readMedication,
} from '@/lib/data/medications';

/**
 * F4 medication catalog data layer. The list 200 is mis-typed as its own query
 * DTO and every medication 200 as the bare entity while the service answers
 * `{ medication }` (GAP-020), so these readers are the ones the composer and
 * the name lookup trust.
 */

const medication = {
  id: 'med_example_7101',
  organizationId: 'org_example_0001',
  category: 'MEDICATION',
  name: 'EXAMPLE Amoxicillin',
  genericName: 'Amoxicillin',
  strength: '500mg',
  form: 'capsule',
  unit: 'capsule',
  sku: 'AMX-500',
  barcode: null,
  isControlled: false,
  isActive: true,
  version: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

describe('readMedication', () => {
  it('reads a serialized catalog item', () => {
    expect(readMedication(medication)).toMatchObject({
      id: 'med_example_7101',
      name: 'EXAMPLE Amoxicillin',
      category: 'MEDICATION',
      strength: '500mg',
      isActive: true,
    });
  });

  it('rejects a row without an id, name, or unit', () => {
    expect(readMedication({})).toBeNull();
    expect(readMedication({ id: 'm' })).toBeNull();
    expect(readMedication({ id: 'm', name: 'n' })).toBeNull();
    expect(readMedication(null)).toBeNull();
  });

  it('defaults an optional field rather than dropping the row', () => {
    const read = readMedication({ id: 'm', name: 'n', unit: 'u' });
    expect(read?.genericName).toBeNull();
    expect(read?.isControlled).toBe(false);
    expect(read?.category).toBe('MEDICATION');
  });
});

describe('extractMedicationPage', () => {
  it('reads the unwrapped data array with a meta total', () => {
    const parsed = extractMedicationPage([medication], { total: 1 });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty array as an empty catalog, not a broken body', () => {
    const parsed = extractMedicationPage([]);
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
    expect(parsed.ok && parsed.page.total).toBe(0);
  });

  it('fails closed when data is missing or malformed', () => {
    expect(extractMedicationPage({})).toEqual({ ok: false });
    expect(extractMedicationPage([{}])).toEqual({ ok: false });
  });
});

describe('extractMedicationRecord', () => {
  it('reads the { medication } body the service answers with', () => {
    const parsed = extractMedicationRecord({ medication });
    expect(parsed.ok && parsed.medication.id).toBe('med_example_7101');
    expect(extractMedicationRecord({})).toEqual({ ok: false });
    expect(extractMedicationRecord(null)).toEqual({ ok: false });
  });
});