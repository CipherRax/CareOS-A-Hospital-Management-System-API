import { describe, expect, it } from 'vitest';

import {
  VITAL_FIELD_KEYS,
  VITAL_FIELD_SPECS,
  VITAL_MEASUREMENT_KEYS,
  byObservedAt,
  correctedIds,
  extractVitalPage,
  extractVitalRecord,
  hasVitalContent,
  readVital,
  type VitalRow,
} from '@/lib/data/vitals';

/**
 * F3 vitals data layer.
 *
 * The export mis-types every vitals 200 as its request DTO and leaves the list
 * query unmodelled (GAP-017), so these readers are the ones the recorder trusts.
 * A reader that accepts a drifted body is an observation that silently vanishes
 * from the chart, or a correction whose chain cannot be followed.
 */

const record = {
  id: 'vr_example_7001',
  patientId: 'pat_example_1001',
  visitId: 'vis_example_3001',
  temperatureC: 37.1,
  systolicMmHg: 118,
  diastolicMmHg: 76,
  pulseBpm: 72,
  respiratoryRate: 16,
  spo2: 98,
  weightKg: 68.4,
  heightCm: 165,
  bmi: 25.1,
  bmiCategory: 'OVERWEIGHT',
  painScore: 2,
  notes: null,
  observedAt: '2026-10-11T09:00:00.000Z',
  correctionOfId: null,
  correctionReason: null,
  recordedByUserId: 'usr_example_9001',
  createdAt: '2026-10-11T09:00:00.000Z',
};

describe('readVital', () => {
  it('reads a serialized vital record', () => {
    expect(readVital(record)).toMatchObject({
      id: 'vr_example_7001',
      patientId: 'pat_example_1001',
      temperatureC: 37.1,
      bmi: 25.1,
      bmiCategory: 'OVERWEIGHT',
    });
  });

  it('rejects a row without an id or patient', () => {
    expect(readVital({})).toBeNull();
    expect(readVital({ id: 'vr_1' })).toBeNull();
    expect(readVital(null)).toBeNull();
  });

  it('reads an unmeasured field as null rather than zero', () => {
    const minimal = { id: 'vr_1', patientId: 'pat_1', temperatureC: 37 };
    const read = readVital(minimal);
    expect(read?.spo2).toBeNull();
    expect(read?.bmi).toBeNull();
    expect(read?.notes).toBeNull();
  });

  it('drops a non-finite measure instead of trusting the wire', () => {
    const read = readVital({ id: 'vr_1', patientId: 'pat_1', temperatureC: 'NaN' });
    expect(read?.temperatureC).toBeNull();
  });
});

describe('extractVitalPage', () => {
  it('reads the { items, meta } body', () => {
    const parsed = extractVitalPage({ items: [record], meta: { total: 1 } });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty items array as a patient with no observations', () => {
    const parsed = extractVitalPage({ items: [] });
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
    expect(parsed.ok && parsed.page.total).toBe(0);
  });

  it('fails closed when items is missing or malformed', () => {
    expect(extractVitalPage({ meta: {} })).toEqual({ ok: false });
    expect(extractVitalPage({ items: [{}] })).toEqual({ ok: false });
    expect(extractVitalPage(null)).toEqual({ ok: false });
  });
});

describe('extractVitalRecord', () => {
  it('reads the { vitalRecord } mutation body', () => {
    const parsed = extractVitalRecord({ vitalRecord: record });
    expect(parsed.ok && parsed.record.id).toBe('vr_example_7001');
    expect(extractVitalRecord({})).toEqual({ ok: false });
    expect(extractVitalRecord({ vitalRecord: {} })).toEqual({ ok: false });
  });
});

describe('correction chain', () => {
  const original = { ...record, id: 'vr_original' } as VitalRow;
  const correction = { ...record, id: 'vr_correction', correctionOfId: 'vr_original' } as VitalRow;

  it('lists the ids a correction superseded', () => {
    expect([...correctedIds([correction, original])]).toEqual(['vr_original']);
  });

  it('marks nothing when there is no correction', () => {
    expect(correctedIds([original]).size).toBe(0);
  });
});

describe('byObservedAt', () => {
  it('orders newest observation first', () => {
    const older = { ...record, id: 'older', observedAt: '2026-10-10T09:00:00.000Z' } as VitalRow;
    const newer = { ...record, id: 'newer', observedAt: '2026-10-11T09:00:00.000Z' } as VitalRow;
    expect(byObservedAt([older, newer]).map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('keeps rows with no timestamp last, without throwing', () => {
    const undated = { ...record, id: 'undated', observedAt: null, createdAt: null } as VitalRow;
    const dated = { ...record, id: 'dated' } as VitalRow;
    expect(byObservedAt([undated, dated]).map((r) => r.id)).toEqual(['dated', 'undated']);
  });
});

describe('hasVitalContent', () => {
  it('accepts any single measurement', () => {
    expect(hasVitalContent({ patientId: 'p', spo2: 98 })).toBe(true);
    expect(hasVitalContent({ patientId: 'p', painScore: 0 })).toBe(true);
  });

  it('rejects an empty measurement set', () => {
    expect(hasVitalContent({ patientId: 'p' })).toBe(false);
    expect(hasVitalContent({ patientId: 'p', temperatureC: '' })).toBe(false);
    expect(hasVitalContent({ patientId: 'p', spo2: null })).toBe(false);
  });

  it('counts notes as content, exactly as the API refine does', () => {
    expect(hasVitalContent({ patientId: 'p', notes: 'Patient declined.' })).toBe(true);
  });
});

describe('field metadata', () => {
  it('mirrors the API bounds so the input cannot accept what the API rejects', () => {
    const specs = new Map(VITAL_FIELD_SPECS.map((spec) => [spec.key, spec]));
    expect(specs.get('temperatureC')).toMatchObject({ min: 28, max: 47, integer: false });
    expect(specs.get('spo2')).toMatchObject({ min: 40, max: 100, integer: true });
    expect(specs.get('painScore')).toMatchObject({ min: 0, max: 10, integer: true });
  });

  it('covers every measurement key exactly once', () => {
    expect(VITAL_FIELD_SPECS.map((spec) => spec.key)).toEqual([...VITAL_MEASUREMENT_KEYS]);
  });

  it('counts notes as a field but not a measurement', () => {
    expect(VITAL_FIELD_KEYS).toContain('notes');
    expect(VITAL_MEASUREMENT_KEYS).not.toContain('notes');
  });
});
