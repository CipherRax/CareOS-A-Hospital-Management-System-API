import { describe, expect, it } from 'vitest';

import {
  IMAGING_MODALITIES,
  RADIOLOGY_REPORT_STATUSES,
  RADIOLOGY_STATUSES,
  extractRadiologyOrderPage,
  extractRadiologyOrderRecord,
  readImagingReport,
  readRadiologyOrder,
} from '@/lib/data/radiology';

/**
 * F4 radiology data layer.
 *
 * The imaging list serializes the full order *with* its report, so this list
 * read alone backs the doctor's imaging results. Same GAP-020 drift as every
 * other list, so each row is validated structurally.
 */

const report = {
  id: 'imr_example_1',
  orderId: 'rad_example_4001',
  findings: 'No focal consolidation. Heart size normal.',
  summary: 'Normal chest radiograph.',
  impression: 'No acute cardiopulmonary abnormality.',
  enteredById: 'usr_example_9002',
  enteredAt: '2026-10-11T10:10:00.000Z',
  verifiedById: 'usr_example_9003',
  verifiedAt: '2026-10-11T10:20:00.000Z',
  version: 1,
};

const order = {
  id: 'rad_example_4001',
  organizationId: 'org_example_0001',
  orderNumber: 'RAD-2026-000001',
  patientId: 'pat_example_1001',
  branchId: 'br_example_0001',
  encounterId: 'enc_example_6001',
  modality: 'XRAY',
  region: 'Chest',
  status: 'RELEASED',
  clinicalNotes: 'Persistent cough.',
  orderedById: 'usr_example_9001',
  orderedAt: '2026-10-11T09:00:00.000Z',
  requestedAt: '2026-10-11T09:30:00.000Z',
  performedById: 'usr_example_9002',
  performedAt: '2026-10-11T10:00:00.000Z',
  cancelledAt: null,
  cancelledReason: null,
  releasedById: 'usr_example_9003',
  releasedAt: '2026-10-11T10:30:00.000Z',
  version: 1,
  report,
};

describe('readRadiologyOrder', () => {
  it('reads a full order with its report', () => {
    const row = readRadiologyOrder(order);
    expect(row?.modality).toBe('XRAY');
    expect(row?.region).toBe('Chest');
    expect(row?.report?.impression).toBe('No acute cardiopulmonary abnormality.');
  });

  it('reads an order still awaiting a report', () => {
    const row = readRadiologyOrder({ ...order, status: 'SCHEDULED', report: null });
    expect(row?.report).toBeNull();
  });

  it('rejects a row without an id, number, patient or a known status', () => {
    expect(readRadiologyOrder({})).toBeNull();
    expect(readRadiologyOrder({ ...order, status: 'NOPE' })).toBeNull();
    expect(readRadiologyOrder(null)).toBeNull();
  });

  it('drops a report that drifts rather than the whole order', () => {
    const row = readRadiologyOrder({ ...order, report: { findings: 'x' } });
    expect(row?.report).toBeNull();
  });
});

describe('readImagingReport', () => {
  it('rejects a report without an id or order id', () => {
    expect(readImagingReport({ findings: 'x' })).toBeNull();
    expect(readImagingReport(null)).toBeNull();
  });
});

describe('extractRadiologyOrderPage', () => {
  it('reads the unwrapped data array with a meta total', () => {
    const page = extractRadiologyOrderPage([order], { total: 1 });
    expect(page.ok && page.page.items[0]?.orderNumber).toBe('RAD-2026-000001');
    expect(page.ok && page.page.total).toBe(1);
  });

  it('treats an empty array as empty and fails closed on a broken body', () => {
    expect(extractRadiologyOrderPage([]).ok && true).toBe(true);
    expect(extractRadiologyOrderPage({})).toEqual({ ok: false });
    expect(extractRadiologyOrderPage([{}])).toEqual({ ok: false });
  });
});

describe('extractRadiologyOrderRecord', () => {
  it('reads the { order } single-read body', () => {
    const record = extractRadiologyOrderRecord({ order });
    expect(record.ok && record.order.id).toBe('rad_example_4001');
    expect(extractRadiologyOrderRecord({ order: {} })).toEqual({ ok: false });
  });
});

describe('constants', () => {
  it('mirror the API domain', () => {
    expect(RADIOLOGY_STATUSES).toEqual([
      'ORDERED',
      'SCHEDULED',
      'PERFORMED',
      'REPORTED',
      'VERIFIED',
      'RELEASED',
      'CANCELLED',
    ]);
    expect(IMAGING_MODALITIES).toContain('XRAY');
    expect(RADIOLOGY_REPORT_STATUSES).toEqual(['REPORTED', 'VERIFIED', 'RELEASED']);
  });
});
