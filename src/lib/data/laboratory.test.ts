import { describe, expect, it } from 'vitest';

import {
  LAB_ORDER_STATUSES,
  LAB_RESULT_STATUSES,
  extractLabOrderPage,
  extractLabOrderRecord,
  extractLabTestPage,
  readLabOrderDetail,
  readLabOrderSummary,
  readLabResult,
  readLabTest,
  readLabTestField,
} from '@/lib/data/laboratory';

/**
 * F4 laboratory data layer.
 *
 * The doctor's results view trusts these readers. The list read is a *thin*
 * projection (no results, no test names) and the export mis-types it as a query
 * DTO (GAP-020), so a reader that accepts a drifted row is a view that would
 * chart a value against the wrong analyte.
 */

const summaryRow = {
  id: 'lab_example_5001',
  organizationId: 'org_example_0001',
  orderNumber: 'LAB-2026-000001',
  patientId: 'pat_example_1001',
  branchId: 'br_example_0001',
  encounterId: 'enc_example_6001',
  status: 'RELEASED',
  priority: 'ROUTINE',
  orderedAt: '2026-10-11T09:00:00.000Z',
  releasedAt: '2026-10-11T09:30:00.000Z',
  cancelledAt: null,
  cancelledReason: null,
  rejectionReason: null,
  version: 1,
  sample: { id: 'lbs_example_1', sampleNumber: 'S-2026-000001', status: 'COMPLETED' },
  items: [{ id: 'loi_example_1', testId: 'lbt_example_cbc' }],
};

const resultRow = {
  id: 'lbr_example_1',
  testFieldId: 'lbf_cbc_hb',
  value: '13.9',
  isAbnormal: false,
  isCritical: false,
  currentVersion: 1,
  amendments: 0,
};

const detailRow = {
  id: 'lab_example_5001',
  organizationId: 'org_example_0001',
  orderNumber: 'LAB-2026-000001',
  patientId: 'pat_example_1001',
  branchId: 'br_example_0001',
  encounterId: 'enc_example_6001',
  status: 'RELEASED',
  priority: 'ROUTINE',
  clinicalNotes: 'Fasting sample.',
  orderedById: 'usr_example_9001',
  orderedAt: '2026-10-11T09:00:00.000Z',
  releasedById: 'usr_example_9002',
  releasedAt: '2026-10-11T09:30:00.000Z',
  cancelledAt: null,
  cancelledReason: null,
  rejectionReason: null,
  version: 1,
  sample: { id: 'lbs_example_1', sampleNumber: 'S-2026-000001', status: 'COMPLETED' },
  items: [
    {
      id: 'loi_example_1',
      testId: 'lbt_example_cbc',
      testCode: 'CBC',
      testName: 'EXAMPLE Full blood count',
      notes: null,
      results: [resultRow],
    },
  ],
};

const testRow = {
  id: 'lbt_example_cbc',
  code: 'CBC',
  name: 'EXAMPLE Full blood count',
  sampleType: 'BLOOD',
  isActive: true,
  fields: [
    {
      id: 'lbf_cbc_hb',
      testId: 'lbt_example_cbc',
      name: 'Haemoglobin',
      fieldType: 'NUMERIC',
      unit: 'g/dL',
      referenceMin: '12',
      referenceMax: '16',
      criticalMin: '7',
      criticalMax: '20',
      allowsValues: null,
      displayOrder: 1,
      isActive: true,
    },
  ],
};

describe('readLabOrderSummary', () => {
  it('reads a thin list row and extracts the ordered test ids', () => {
    const row = readLabOrderSummary(summaryRow);
    expect(row?.orderNumber).toBe('LAB-2026-000001');
    expect(row?.itemTestIds).toEqual(['lbt_example_cbc']);
    expect(row?.sample?.status).toBe('COMPLETED');
  });

  it('rejects a row without an id, number, patient or a known status', () => {
    expect(readLabOrderSummary({})).toBeNull();
    expect(readLabOrderSummary({ ...summaryRow, status: 'NOPE' })).toBeNull();
    expect(readLabOrderSummary(null)).toBeNull();
  });

  it('defaults a missing priority and sample rather than dropping the row', () => {
    const { priority: _priority, sample: _sample, ...rest } = summaryRow;
    const row = readLabOrderSummary(rest);
    expect(row?.priority).toBe('ROUTINE');
    expect(row?.sample).toBeNull();
  });
});

describe('readLabOrderDetail', () => {
  it('reads a full order with named items and results', () => {
    const row = readLabOrderDetail(detailRow);
    expect(row?.items[0]?.testName).toBe('EXAMPLE Full blood count');
    expect(row?.items[0]?.results[0]?.value).toBe('13.9');
  });

  it('fails closed when an item carries a malformed result', () => {
    expect(
      readLabOrderDetail({
        ...detailRow,
        items: [{ id: 'loi_1', testId: 'lbt_1', results: [{}] }],
      }),
    ).toBeNull();
    expect(readLabOrderDetail({ ...detailRow, items: 'broken' })).toBeNull();
  });
});

describe('readLabResult', () => {
  it('defaults the flags and the amendment count', () => {
    const row = readLabResult({ id: 'lbr_1', testFieldId: 'lbf_1', value: '9.2' });
    expect(row?.isAbnormal).toBe(false);
    expect(row?.isCritical).toBe(false);
    expect(row?.amendments).toBe(0);
  });

  it('rejects a result without a field id or a value', () => {
    expect(readLabResult({ id: 'lbr_1' })).toBeNull();
    expect(readLabResult(null)).toBeNull();
  });
});

describe('catalog', () => {
  it('reads a test with its fields', () => {
    const row = readLabTest(testRow);
    expect(row?.fields[0]?.name).toBe('Haemoglobin');
    expect(readLabTestField(testRow.fields[0])?.unit).toBe('g/dL');
  });

  it('rejects a test with a broken field list', () => {
    expect(readLabTest({ id: 'lbt_1', code: 'C', name: 'X', fields: [{}] })).toBeNull();
    expect(readLabTest({ id: 'lbt_1', code: 'C', name: 'X' })).toBeNull();
  });
});

describe('extractors', () => {
  it('reads the list page and the { order } detail body', () => {
    const page = extractLabOrderPage([summaryRow], { total: 1 });
    expect(page.ok && page.page.items).toHaveLength(1);
    const record = extractLabOrderRecord({ order: detailRow });
    expect(record.ok && record.order.id).toBe('lab_example_5001');
    expect(extractLabOrderPage([{}])).toEqual({ ok: false });
    expect(extractLabOrderRecord({ order: {} })).toEqual({ ok: false });
  });

  it('reads the lab-test catalog page', () => {
    const page = extractLabTestPage([testRow], { total: 1 });
    expect(page.ok && page.page.items[0]?.code).toBe('CBC');
    expect(extractLabTestPage({})).toEqual({ ok: false });
  });
});

describe('LAB_RESULT_STATUSES', () => {
  it('is the result-bearing subset of the order statuses', () => {
    expect(LAB_RESULT_STATUSES).toEqual(['RESULT_READY', 'VERIFIED', 'RELEASED']);
    expect(LAB_RESULT_STATUSES.every((status) => LAB_ORDER_STATUSES.includes(status))).toBe(true);
  });
});
