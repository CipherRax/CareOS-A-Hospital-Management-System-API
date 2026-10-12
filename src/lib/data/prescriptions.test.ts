import { describe, expect, it } from 'vitest';

import {
  PRESCRIPTION_ACTIONS_BY_STATUS,
  extractPrescriptionPage,
  extractPrescriptionRecord,
  readPrescription,
  readPrescriptionItem,
} from '@/lib/data/prescriptions';

/**
 * F4 prescriptions data layer.
 *
 * Same GAP-020 drift as encounters/clinical notes: the list 200 is mis-typed as
 * its own query DTO and every prescription 200 as the bare entity while the
 * service answers `{ prescription }`. These readers are the ones the workspace
 * trusts; a reader that accepts a drifted prescription is a workspace that
 * charts against a ghost.
 */

const item = {
  id: 'pri_example_8001',
  medicationId: 'med_example_7101',
  quantity: 21,
  dispensedQuantity: 0,
  dosage: '500mg',
  frequency: '8 hourly',
  durationDays: 7,
  instructions: 'Take after food.',
};

const prescription = {
  id: 'prx_example_7001',
  organizationId: 'org_example_0001',
  branchId: 'br_example_0001',
  patientId: 'pat_example_1001',
  providerId: 'usr_example_9001',
  status: 'DRAFT',
  notes: null,
  issuedById: null,
  issuedAt: null,
  dispensedAt: null,
  cancelledById: null,
  cancelledAt: null,
  cancelReason: null,
  version: 1,
  items: [item],
};

describe('readPrescriptionItem', () => {
  it('reads a serialized line item', () => {
    expect(readPrescriptionItem(item)).toMatchObject({
      medicationId: 'med_example_7101',
      quantity: 21,
      dispensedQuantity: 0,
      dosage: '500mg',
      durationDays: 7,
    });
  });

  it('rejects an item without an id, medication, or quantity', () => {
    expect(readPrescriptionItem({})).toBeNull();
    expect(readPrescriptionItem({ id: 'i' })).toBeNull();
    expect(readPrescriptionItem({ id: 'i', medicationId: 'm' })).toBeNull();
    expect(readPrescriptionItem(null)).toBeNull();
  });

  it('defaults an optional field to null rather than dropping the item', () => {
    const read = readPrescriptionItem({ id: 'i', medicationId: 'm', quantity: 3 });
    expect(read?.dispensedQuantity).toBe(0);
    expect(read?.dosage).toBeNull();
    expect(read?.instructions).toBeNull();
  });
});

describe('readPrescription', () => {
  it('reads a serialized prescription with its line items', () => {
    const read = readPrescription(prescription);
    expect(read).toMatchObject({
      id: 'prx_example_7001',
      patientId: 'pat_example_1001',
      providerId: 'usr_example_9001',
      status: 'DRAFT',
      version: 1,
    });
    expect(read?.items).toHaveLength(1);
  });

  it('rejects a row with an unknown status', () => {
    expect(readPrescription({ ...prescription, status: 'VOID' })).toBeNull();
  });

  it('rejects when any line item is unusable', () => {
    expect(readPrescription({ ...prescription, items: [{}] })).toBeNull();
    expect(readPrescription({ ...prescription, items: item })).toBeNull();
  });

  it('rejects a row without id, patient, provider, or items', () => {
    expect(readPrescription({})).toBeNull();
    expect(readPrescription({ id: 'p' })).toBeNull();
    expect(readPrescription(null)).toBeNull();
  });
});

describe('extractPrescriptionPage', () => {
  it('reads the unwrapped data array with a meta total', () => {
    const parsed = extractPrescriptionPage([prescription], { total: 1 });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty array as an empty history, not a broken body', () => {
    const parsed = extractPrescriptionPage([]);
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
    expect(parsed.ok && parsed.page.total).toBe(0);
  });

  it('fails closed when data is missing or malformed', () => {
    expect(extractPrescriptionPage({})).toEqual({ ok: false });
    expect(extractPrescriptionPage([{}])).toEqual({ ok: false });
    expect(extractPrescriptionPage(null)).toEqual({ ok: false });
  });
});

describe('extractPrescriptionRecord', () => {
  it('reads the { prescription } body every write answers with', () => {
    const parsed = extractPrescriptionRecord({ prescription });
    expect(parsed.ok && parsed.prescription.id).toBe('prx_example_7001');
    expect(extractPrescriptionRecord({})).toEqual({ ok: false });
    expect(extractPrescriptionRecord({ prescription: {} })).toEqual({ ok: false });
    expect(extractPrescriptionRecord(null)).toEqual({ ok: false });
  });
});

describe('PRESCRIPTION_ACTIONS_BY_STATUS', () => {
  it('mirrors the domain lifecycle: issue only from DRAFT, cancel while un- or partially-dispensed', () => {
    expect(PRESCRIPTION_ACTIONS_BY_STATUS.DRAFT).toEqual(['issue', 'cancel']);
    expect(PRESCRIPTION_ACTIONS_BY_STATUS.ISSUED).toEqual(['cancel']);
    expect(PRESCRIPTION_ACTIONS_BY_STATUS.PARTIALLY_DISPENSED).toEqual(['cancel']);
    expect(PRESCRIPTION_ACTIONS_BY_STATUS.DISPENSED).toEqual([]);
    expect(PRESCRIPTION_ACTIONS_BY_STATUS.CANCELLED).toEqual([]);
  });
});