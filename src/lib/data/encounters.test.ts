import { describe, expect, it } from 'vitest';

import {
  ENCOUNTER_TRANSITIONS,
  extractEncounterPage,
  extractEncounterRecord,
  readEncounter,
} from '@/lib/data/encounters';

/**
 * F4 encounters data layer.
 *
 * The export types every encounter 200 as the bare entity while the service
 * answers `{ encounter }`, and mis-types the list 200 as its own query DTO
 * (GAP-020), so these readers are the ones the workspace trusts. A reader that
 * accepts a drifted encounter is a workspace that charts against a ghost.
 */

const encounter = {
  id: 'enc_example_6001',
  organizationId: 'org_example_0001',
  branchId: 'br_example_0001',
  departmentId: 'dep_example_outpatient',
  patientId: 'pat_example_1001',
  providerId: 'usr_example_9001',
  type: 'OUTPATIENT',
  status: 'OPEN',
  visitId: 'vis_example_3001',
  appointmentId: null,
  note: null,
  openedById: 'usr_example_9002',
  openedAt: '2026-10-11T09:00:00.000Z',
  inProgressAt: null,
  completedAt: null,
  version: 1,
  createdAt: '2026-10-11T09:00:00.000Z',
  updatedAt: '2026-10-11T09:00:00.000Z',
};

describe('readEncounter', () => {
  it('reads a serialized encounter', () => {
    expect(readEncounter(encounter)).toMatchObject({
      id: 'enc_example_6001',
      patientId: 'pat_example_1001',
      status: 'OPEN',
      type: 'OUTPATIENT',
      providerId: 'usr_example_9001',
    });
  });

  it('rejects a row without an id, patient, status, or openedAt', () => {
    expect(readEncounter({})).toBeNull();
    expect(readEncounter({ id: 'enc_1' })).toBeNull();
    expect(readEncounter({ id: 'enc_1', patientId: 'p', status: 'OPEN' })).toBeNull();
    expect(readEncounter(null)).toBeNull();
  });

  it('defaults an optional reference to null rather than dropping the row', () => {
    const minimal = {
      id: 'enc_1',
      patientId: 'pat_1',
      status: 'OPEN',
      type: 'EMERGENCY',
      openedAt: '2026-10-11T09:00:00.000Z',
    };
    const read = readEncounter(minimal);
    expect(read?.visitId).toBeNull();
    expect(read?.completedAt).toBeNull();
    expect(read?.note).toBeNull();
  });
});

describe('extractEncounterPage', () => {
  it('reads the unwrapped data array with a meta total', () => {
    const parsed = extractEncounterPage([encounter], { total: 1 });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty data array as an empty day, not a broken body', () => {
    const parsed = extractEncounterPage([]);
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
    expect(parsed.ok && parsed.page.total).toBe(0);
  });

  it('fails closed when data is missing or malformed', () => {
    expect(extractEncounterPage({})).toEqual({ ok: false });
    expect(extractEncounterPage([{}])).toEqual({ ok: false });
    expect(extractEncounterPage(null)).toEqual({ ok: false });
  });
});

describe('extractEncounterRecord', () => {
  it('reads the { encounter } body every write answers with', () => {
    const parsed = extractEncounterRecord({ encounter });
    expect(parsed.ok && parsed.encounter.id).toBe('enc_example_6001');
    expect(extractEncounterRecord({})).toEqual({ ok: false });
    expect(extractEncounterRecord({ encounter: {} })).toEqual({ ok: false });
    expect(extractEncounterRecord(null)).toEqual({ ok: false });
  });
});

describe('ENCOUNTER_TRANSITIONS', () => {
  it('mirrors the workflow system edges and the terminal lock', () => {
    expect(ENCOUNTER_TRANSITIONS.OPEN).toEqual(['IN_PROGRESS']);
    expect(ENCOUNTER_TRANSITIONS.IN_PROGRESS).toEqual(['COMPLETED']);
    expect(ENCOUNTER_TRANSITIONS.COMPLETED).toEqual([]);
  });
});