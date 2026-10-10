import { describe, expect, it } from 'vitest';

import {
  buildDisplayName,
  extractPatientList,
  extractPatientMaster,
  extractPatientPage,
  readPatientRow,
  readTimelineEvent,
} from '@/lib/data/patients';
import { candidatesFromRegisterError } from '@/lib/data/queries';

/**
 * F2 patient-registry data layer.
 *
 * The screens trust these readers, so a reader that accepts a drifted body is a
 * bad day for the person at reception. Everything below is the raw contract
 * re-exported from the API document (master envelope noted GAP-013).
 */

const row = {
  id: 'pat_example_1001',
  patientNumber: 'PAT-2026-000001',
  firstName: 'EXAMPLE',
  otherNames: 'Amina',
  lastName: 'Yusuf',
  dateOfBirth: '1992-05-14',
  sex: 'FEMALE',
  phone: '0700000001',
  county: 'Mombasa',
  town: 'Old Town',
  status: 'ACTIVE',
  version: 1,
};

describe('buildDisplayName', () => {
  it('joins first, middle, last', () => {
    expect(buildDisplayName('EXAMPLE', 'Amina', 'Yusuf')).toBe('EXAMPLE Amina Yusuf');
  });

  it('drops absent middle names and collapses whitespace', () => {
    expect(buildDisplayName('EXAMPLE', '', 'Yusuf')).toBe('EXAMPLE Yusuf');
    expect(buildDisplayName('  EXAMPLE  ', null, '  Yusuf ')).toBe('EXAMPLE Yusuf');
  });

  it('returns an empty string when nothing name-like is present', () => {
    expect(buildDisplayName(null, '', undefined)).toBe('');
  });
});

describe('readPatientRow', () => {
  it('reads a serialized patient', () => {
    expect(readPatientRow(row)).toMatchObject({
      id: 'pat_example_1001',
      patientNumber: 'PAT-2026-000001',
      displayName: 'EXAMPLE Amina Yusuf',
      dateOfBirth: '1992-05-14',
      phone: '0700000001',
      county: 'Mombasa',
      town: 'Old Town',
      status: 'ACTIVE',
    });
  });

  it('rejects a row that cannot be a patient', () => {
    expect(readPatientRow({})).toBeNull();
    expect(readPatientRow({ patientNumber: 5 })).toBeNull();
    expect(readPatientRow(null)).toBeNull();
  });

  it('defaults absent optionals to null', () => {
    const minimal = {
      id: row.id,
      patientNumber: row.patientNumber,
      firstName: row.firstName,
      otherNames: row.otherNames,
      lastName: row.lastName,
    };
    const read = readPatientRow(minimal as unknown as Record<string, unknown>);
    expect(read && read.county).toBeNull();
    expect(read && read.town).toBeNull();
    expect(read && read.status).toBe('');
  });
});

describe('extractPatientList', () => {
  it('extracts the row list', () => {
    const result = extractPatientList({
      success: true,
      data: { items: [row], meta: { total: 1 } },
    });
    expect(result.ok && result.page.total).toBe(1);
    expect(result.ok && result.page.items.length).toBe(1);
  });

  it('defaults the total to the row count without a meta block', () => {
    const result = extractPatientList({ success: true, data: { items: [row] } });
    expect(result.ok && result.page.total).toBe(1);
  });

  it('counts an empty `items` array as a legitimate no-result search', () => {
    const result = extractPatientList({ success: true, data: { items: [] } });
    expect(result).toEqual({ ok: true, page: { items: [], total: 0 } });
  });

  it('rejects a non-success envelope and a broken row', () => {
    expect(extractPatientList({ success: false })).toEqual({ ok: false });
    expect(extractPatientList({ success: true, data: {} })).toEqual({ ok: false });
    expect(
      extractPatientList({
        success: true,
        data: { items: [{ patientNumber: 5 }] },
      }),
    ).toEqual({ ok: false });
  });
});

describe('extractPatientMaster', () => {
  const envelope = {
    success: true,
    data: {
      patient: row,
      sections: {
        guardians: [
          {
            id: 'g-1',
            firstName: 'EXAMPLE',
            lastName: 'Hasan',
            relationship: 'Guardian',
            phone: '0700000002',
          },
        ],
        consents: [{ type: 'TREATMENT', status: 'GRANTED' }],
        allergies: [{ id: 'a-1', substance: 'Penicillin', severity: 'SEVERE' }],
        medicalHistory: [
          { category: 'DIABETES', description: 'Type 2, diagnosed 2018', onsetDate: '2018-06-01' },
        ],
      },
    },
  };

  it('extracts the patient and all four sections', () => {
    const result = extractPatientMaster(envelope);
    expect(result.ok && result.record?.patient.displayName).toBe('EXAMPLE Amina Yusuf');
    expect(result.ok && result.record?.sections.guardians).toHaveLength(1);
    const ok = result as { ok: true; record: import('@/lib/data/patients').PatientMasterRecord };
    if (!ok.ok) throw new Error('expected ok');
    expect(ok.record.sections.consents[0]?.type).toBe('TREATMENT');
    expect(ok.record.sections.allergies[0]?.substance).toBe('Penicillin');
    expect(ok.record.sections.medicalHistory[0]?.category).toBe('DIABETES');
  });

  it('fails closed when the sections block is missing entirely', () => {
    // An absent block cannot distinguish "nothing recorded" from a drifted body,
    // so the envelope is rejected rather than rendered as an empty record.
    expect(extractPatientMaster({ success: true, data: { patient: row } })).toEqual({ ok: false });
  });

  it('treats explicit empty section arrays as "no data recorded"', () => {
    const result = extractPatientMaster({
      success: true,
      data: {
        patient: row,
        sections: {
          guardians: [],
          consents: [],
          allergies: [],
          medicalHistory: [],
        },
      },
    });
    expect(result.ok && result.record.sections.guardians).toEqual([]);
    expect(result.ok && result.record.sections.allergies).toEqual([]);
  });

  it('rejects a drifted body rather than rendering a banner', () => {
    const broken = JSON.parse(JSON.stringify(envelope));
    broken.data.patient.phone = { not: 'a string' };
    // phone is optional, so this still reads; break the patientNumber instead.
    delete broken.data.patient.patientNumber;
    expect(extractPatientMaster(broken)).toEqual({ ok: false });

    const brokenSections = JSON.parse(JSON.stringify(envelope));
    brokenSections.data.sections.guardians = [{ firstName: 'no lastName' }];
    expect(extractPatientMaster(brokenSections)).toEqual({ ok: false });
  });
});

describe('extractPatientPage', () => {
  it('reads items and the meta total', () => {
    const result = extractPatientPage({
      success: true,
      data: { items: ['a'], meta: { total: 12 } },
    });
    expect(result).toEqual({ ok: true, items: ['a'], total: 12 });
  });

  it('defaults the total to the item count', () => {
    const result = extractPatientPage({ success: true, data: { items: ['a', 'b'] } });
    expect(result).toEqual({ ok: true, items: ['a', 'b'], total: 2 });
  });
});

describe('readTimelineEvent', () => {
  it('reads the export field names (title/occurredAt)', () => {
    const result = readTimelineEvent({
      id: 'e-1',
      occurredAt: '2026-10-05T09:00:00Z',
      title: 'Registered',
      type: 'PATIENT_CREATED',
    });
    expect(result.ok && result.event).toMatchObject({
      summary: 'Registered',
      timestamp: '2026-10-05T09:00:00Z',
      type: 'PATIENT_CREATED',
    });
  });

  it('still reads the legacy fixture field names (summary/createdAt)', () => {
    const result = readTimelineEvent({
      id: 'e-1',
      createdAt: '2026-10-05T09:00:00Z',
      summary: 'Walk-in registration',
      author: { displayName: 'EXAMPLE Registrar' },
    });
    expect(result.ok && result.event.author).toBe('EXAMPLE Registrar');
  });

  it('rejects a row with neither a timestamp nor a title', () => {
    expect(readTimelineEvent({ id: 'e-1' })).toEqual({ ok: false });
    expect(readTimelineEvent(null)).toEqual({ ok: false });
  });
});

describe('candidatesFromRegisterError', () => {
  const candidate = {
    patientId: 'pat_example_1002',
    patientNumber: 'PAT-2026-000002',
    firstName: 'EXAMPLE',
    lastName: 'Yusuf',
    dateOfBirth: '1992-05-14',
    score: 0.92,
    reasons: ['name-match', 'dob-match'],
  };

  it('reads candidates out of the 409 error envelope', () => {
    const candidates = candidatesFromRegisterError({
      error: { code: 'POSSIBLE_DUPLICATE', details: { candidates: [candidate] } },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      patientId: 'pat_example_1002',
      score: 0.92,
      reasons: ['name-match', 'dob-match'],
    });
  });

  it('returns an empty list for a non-duplicate error', () => {
    expect(candidatesFromRegisterError({ error: { code: 'VALIDATION_ERROR' } })).toEqual([]);
    expect(candidatesFromRegisterError('gateway exploded')).toEqual([]);
    expect(candidatesFromRegisterError(undefined)).toEqual([]);
  });

  it('drops malformed candidates', () => {
    const candidates = candidatesFromRegisterError({
      error: { code: 'POSSIBLE_DUPLICATE', details: { candidates: [candidate, { firstName: 5 }] } },
    });
    expect(candidates).toHaveLength(1);
  });
});