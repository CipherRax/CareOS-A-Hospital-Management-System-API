import { describe, expect, it } from 'vitest';

import {
  NOTE_SECTION_KEYS,
  extractNotePage,
  extractNoteRecord,
  extractTemplatePage,
  extractTemplateRecord,
  readNote,
  readSections,
  readTemplate,
} from '@/lib/data/clinical-notes';

/**
 * F4 clinical notes data layer.
 *
 * The export types every note 200 as the bare entity while the service answers
 * `{ note }`, and mis-types the list 200s as their own query DTOs (GAP-020), so
 * these readers are the ones the workspace trusts. A reader that accepts a
 * drifted note is a workspace that charts against a ghost.
 */

const note = {
  id: 'cn_example_8001',
  organizationId: 'org_example_0001',
  patientId: 'pat_example_1001',
  encounterId: 'enc_example_6001',
  authorId: 'usr_example_9001',
  status: 'FINAL',
  title: 'Initial assessment',
  sections: { chiefComplaint: 'Cough for three days.', plan: 'Chest X-ray.' },
  reason: null,
  templateId: null,
  finalizedAt: '2026-10-11T09:30:00.000Z',
  createdAt: '2026-10-11T09:10:00.000Z',
  updatedAt: '2026-10-11T09:30:00.000Z',
};

const version = {
  id: 'cnv_example_8101',
  versionNumber: 1,
  kind: 'ORIGINAL',
  title: 'Initial assessment',
  sections: { chiefComplaint: 'Cough for three days.', plan: 'Chest X-ray.' },
  reason: null,
  authorId: 'usr_example_9001',
  createdAt: '2026-10-11T09:30:00.000Z',
};

const template = {
  id: 'cnt_example_8201',
  organizationId: 'org_example_0001',
  name: 'EXAMPLE outpatient note',
  description: null,
  departmentId: 'dep_example_outpatient',
  sections: ['chiefComplaint', 'history', 'assessment', 'plan'],
  isActive: true,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

describe('readSections', () => {
  it('reads a record of note-section text', () => {
    expect(readSections({ chiefComplaint: 'Cough.', plan: 'X-ray.' })).toEqual({
      chiefComplaint: 'Cough.',
      plan: 'X-ray.',
    });
  });

  it('accepts an empty object and unknown keys so content survives a new section', () => {
    expect(readSections({})).toEqual({});
    expect(readSections({ history: 'Unremarkable.' })).toEqual({ history: 'Unremarkable.' });
  });

  it('rejects a non-record or a non-string value', () => {
    expect(readSections(null)).toBeNull();
    expect(readSections(['chiefComplaint'])).toBeNull();
    expect(readSections({ chiefComplaint: 4 })).toBeNull();
  });
});

describe('readNote', () => {
  it('reads a serialized note', () => {
    expect(readNote(note)).toMatchObject({
      id: 'cn_example_8001',
      encounterId: 'enc_example_6001',
      patientId: 'pat_example_1001',
      status: 'FINAL',
      title: 'Initial assessment',
      versions: null,
    });
  });

  it('rejects a row without an id, encounter, patient, status, or createdAt', () => {
    expect(readNote({})).toBeNull();
    expect(readNote({ id: 'cn_1' })).toBeNull();
    expect(readNote({ id: 'cn_1', encounterId: 'e', patientId: 'p', status: 'DRAFT' })).toBeNull();
    expect(readNote(null)).toBeNull();
  });

  it('defaults an optional reference to null rather than dropping the row', () => {
    const minimal = {
      id: 'cn_1',
      encounterId: 'enc_1',
      patientId: 'pat_1',
      authorId: 'usr_1',
      status: 'DRAFT',
      sections: {},
      createdAt: '2026-10-11T09:00:00.000Z',
    };
    const read = readNote(minimal);
    expect(read?.title).toBeNull();
    expect(read?.reason).toBeNull();
    expect(read?.finalizedAt).toBeNull();
  });

  it('reads a note with its full version history', () => {
    const read = readNote({ ...note, versions: [version] });
    expect(read?.versions?.[0]).toMatchObject({ versionNumber: 1, kind: 'ORIGINAL' });
  });

  it('rejects when the version history is present but malformed', () => {
    expect(readNote({ ...note, versions: [{ id: 'cnv_1' }] })).toBeNull();
    expect(readNote({ ...note, versions: 'broken' })).toBeNull();
  });
});

describe('extractNotePage', () => {
  it('reads the unwrapped data array with a meta total', () => {
    const parsed = extractNotePage([note], { total: 1 });
    expect(parsed.ok && parsed.page.items).toHaveLength(1);
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('treats an empty data array as empty, not a broken body', () => {
    const parsed = extractNotePage([]);
    expect(parsed.ok && parsed.page.items).toHaveLength(0);
  });

  it('fails closed when data is missing or malformed', () => {
    expect(extractNotePage({})).toEqual({ ok: false });
    expect(extractNotePage([{}])).toEqual({ ok: false });
    expect(extractNotePage(null)).toEqual({ ok: false });
  });
});

describe('extractNoteRecord', () => {
  it('reads the { note } body every note write answers with', () => {
    const parsed = extractNoteRecord({ note });
    expect(parsed.ok && parsed.note.id).toBe('cn_example_8001');
    expect(extractNoteRecord({})).toEqual({ ok: false });
    expect(extractNoteRecord({ note: {} })).toEqual({ ok: false });
    expect(extractNoteRecord(null)).toEqual({ ok: false });
  });
});

describe('templates', () => {
  it('extracts the template list and the { template } write body', () => {
    const page = extractTemplatePage([template], { total: 1 });
    expect(page.ok && page.page.items[0]?.name).toBe('EXAMPLE outpatient note');
    const record = extractTemplateRecord({ template });
    expect(record.ok && record.template.sections).toEqual(['chiefComplaint', 'history', 'assessment', 'plan']);
    expect(extractTemplatePage({ items: [] })).toEqual({ ok: false });
    expect(extractTemplateRecord({ template: { id: 'cnt_1' } })).toEqual({ ok: false });
  });

  it('rejects a template without name or a broken section list', () => {
    expect(readTemplate({ id: 'cnt_1' })).toBeNull();
    expect(readTemplate({ id: 'cnt_1', name: 'X', sections: [4] })).toBeNull();
  });
});

describe('NOTE_SECTION_KEYS', () => {
  it('mirrors the API note-versioning domain', () => {
    expect(NOTE_SECTION_KEYS).toEqual([
      'chiefComplaint',
      'history',
      'subjective',
      'objective',
      'assessment',
      'plan',
      'instructions',
      'followUp',
    ]);
  });
});