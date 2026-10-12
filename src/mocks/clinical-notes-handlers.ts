import { http, HttpResponse } from 'msw';

import {
  NOTES,
  NOTE_TEMPLATES,
  type NoteFixture,
  type NoteTemplateFixture,
} from '@/mocks/fixtures/clinical-notes-registry';
import { ENCOUNTERS } from '@/mocks/fixtures/encounters-registry';
import { NOTE_SECTION_KEYS } from '@/lib/data/clinical-notes';
import { delay, apiError, apiOk, apiPage, MOCK_LATENCY_MS } from './handlers';

/**
 * F4 clinical-notes handlers (doctor workspace).
 *
 * Same contract and records as `e2e/stub-api.mjs`. The list is mutable so a note
 * created or finalized in the workspace appears on the visit's note list. The
 * lifecycle mirrors the API domain: notes are created DRAFT, edited in place,
 * finalized into the ORIGINAL version, and afterwards only amended (superseding
 * version, mandatory reason). Notes can only be created against an OPEN or
 * IN_PROGRESS encounter; the API answers 409 INVALID_WORKFLOW_TRANSITION for a
 * completed one, and the handler does the same.
 */

const NOTE_STATUS = { DRAFT: 'DRAFT', FINAL: 'FINAL' } as const;
type NoteStatus = (typeof NOTE_STATUS)[keyof typeof NOTE_STATUS];

interface LiveVersion {
  id: string;
  versionNumber: number;
  kind: string;
  title: string | null;
  sections: Record<string, string>;
  reason: string | null;
  authorId: string;
  createdAt: string;
}

interface LiveNote {
  id: string;
  organizationId: string;
  patientId: string;
  encounterId: string;
  authorId: string;
  status: NoteStatus;
  title: string | null;
  sections: Record<string, string>;
  reason: string | null;
  templateId: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _versions: LiveVersion[];
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

let versionSeq = 9100;

function serializeNote(note: LiveNote) {
  const { _versions: _versions_, ...body } = note;
  return body;
}

function serializeWithVersions(note: LiveNote) {
  const { _versions, ...body } = note;
  return {
    ...body,
    versions: _versions.map(({ id, versionNumber, kind, title, sections, reason, authorId, createdAt }) => ({
      id,
      versionNumber,
      kind,
      title,
      sections,
      reason,
      authorId,
      createdAt,
    })),
  };
}

function fromFixture(fixture: NoteFixture): LiveNote {
  const createdAt = minutesAgo(fixture.createdMinutesAgo);
  const updatedAt = minutesAgo(fixture.updatedMinutesAgo);
  const finalizedAt =
    fixture.finalizedMinutesAgo === null ? null : minutesAgo(fixture.finalizedMinutesAgo);
  return {
    id: fixture.id,
    organizationId: 'org_example_0001',
    patientId: fixture.patientId,
    encounterId: fixture.encounterId,
    authorId: fixture.authorId,
    status: fixture.status,
    title: fixture.title,
    sections: { ...fixture.sections },
    reason: fixture.reason,
    templateId: fixture.templateId,
    finalizedAt,
    createdAt,
    updatedAt,
    _versions: fixture.versions.map((version) => ({
      id: `cnv_example_${versionSeq++}`,
      versionNumber: version.versionNumber,
      kind: version.kind,
      title: version.title,
      sections: { ...version.sections },
      reason: version.reason,
      authorId: version.authorId,
      createdAt: minutesAgo(version.minutesAgo),
    })),
  };
}

function fromTemplate(template: NoteTemplateFixture): {
  id: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  sections: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    departmentId: template.departmentId,
    sections: [...template.sections],
    isActive: template.isActive,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  };
}

const LIVE: LiveNote[] = NOTES.map(fromFixture);
const LIVE_TEMPLATES = NOTE_TEMPLATES.map(fromTemplate);

function validateSections(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const sections: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string') return null;
    if (!NOTE_SECTION_KEYS.includes(key as (typeof NOTE_SECTION_KEYS)[number])) return null;
    sections[key] = text;
  }
  return sections;
}

function sectionsForTemplate(templateId: string): Record<string, string> | null {
  const template = LIVE_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) return null;
  const sections: Record<string, string> = {};
  for (const key of template.sections) sections[key] = '';
  return sections;
}

export function clinicalNotesHandlers() {
  return [
    http.get('*/api/v1/clinical-notes', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const patientId = url.searchParams.get('patientId');
      const encounterId = url.searchParams.get('encounterId');
      const status = url.searchParams.get('status');

      let rows = [...LIVE];
      if (patientId) rows = rows.filter((row) => row.patientId === patientId);
      if (encounterId) rows = rows.filter((row) => row.encounterId === encounterId);
      if (status) rows = rows.filter((row) => row.status === status);
      rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return HttpResponse.json(apiPage(rows.map(serializeNote), rows.length, 50));
    }),

    http.get('*/api/v1/clinical-notes/templates', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const departmentId = url.searchParams.get('departmentId');
      let rows = [...LIVE_TEMPLATES];
      if (departmentId) rows = rows.filter((template) => template.departmentId === departmentId);
      return HttpResponse.json(apiPage(rows.map(fromTemplate), rows.length, 100));
    }),

    http.get('*/api/v1/clinical-notes/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const note = LIVE.find((row) => row.id === params.id);
      if (!note) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Clinical note not found'), {
          status: 404,
        });
      }
      return HttpResponse.json(apiOk({ note: serializeWithVersions(note) }, 'req_mock_note_get'));
    }),

    http.post('*/api/v1/clinical-notes', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      if (typeof body.encounterId !== 'string') {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'encounterId required'), {
          status: 400,
        });
      }
      const encounter = ENCOUNTERS.find((row) => row.id === body.encounterId);
      if (!encounter) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Encounter not found'), {
          status: 404,
        });
      }
      if (encounter.status === 'COMPLETED') {
        return HttpResponse.json(
          apiError(
            'INVALID_WORKFLOW_TRANSITION',
            'Clinical entries can only be added to an OPEN or IN_PROGRESS encounter.',
          ),
          { status: 409 },
        );
      }

      let sections: Record<string, string> | null = null;
      if (body.sections !== undefined) sections = validateSections(body.sections);
      else if (typeof body.templateId === 'string') sections = sectionsForTemplate(body.templateId);
      if (!sections || Object.keys(sections).length === 0) {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'sections or templateId required'), {
          status: 400,
        });
      }

      const now = new Date().toISOString();
      const note: LiveNote = {
        id: `cn_example_${8000 + LIVE.length + 1}`,
        organizationId: 'org_example_0001',
        patientId: encounter.patientId,
        encounterId: body.encounterId,
        authorId: 'usr_example_9001',
        status: NOTE_STATUS.DRAFT,
        title: typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null,
        sections,
        reason: null,
        templateId: typeof body.templateId === 'string' ? body.templateId : null,
        finalizedAt: null,
        createdAt: now,
        updatedAt: now,
        _versions: [],
      };
      LIVE.push(note);
      return HttpResponse.json(apiOk({ note: serializeNote(note) }, 'req_mock_note_create'), {
        status: 201,
      });
    }),

    http.patch('*/api/v1/clinical-notes/:id', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      const note = LIVE.find((row) => row.id === params.id);
      if (!note) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Clinical note not found'), {
          status: 404,
        });
      }
      if (note.status !== NOTE_STATUS.DRAFT) {
        return HttpResponse.json(
          apiError('INVALID_WORKFLOW_TRANSITION', 'FINAL notes are locked; changes go through amend.'),
          { status: 409 },
        );
      }
      if (body.title !== undefined) {
        note.title =
          typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : null;
      }
      if (body.sections !== undefined) {
        const sections = validateSections(body.sections);
        if (!sections) {
          return HttpResponse.json(apiError('VALIDATION_ERROR', 'sections invalid'), {
            status: 400,
          });
        }
        note.sections = sections;
      }
      note.updatedAt = new Date().toISOString();
      return HttpResponse.json(apiOk({ note: serializeNote(note) }, 'req_mock_note_update'));
    }),

    http.post('*/api/v1/clinical-notes/:id/finalize', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const note = LIVE.find((row) => row.id === params.id);
      if (!note) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Clinical note not found'), {
          status: 404,
        });
      }
      if (note.status !== NOTE_STATUS.DRAFT) {
        return HttpResponse.json(
          apiError('INVALID_WORKFLOW_TRANSITION', 'This note is already FINAL.'),
          { status: 409 },
        );
      }
      const now = new Date().toISOString();
      note.status = NOTE_STATUS.FINAL;
      note.finalizedAt = now;
      note.updatedAt = now;
      note._versions.push({
        id: `cnv_example_${versionSeq++}`,
        versionNumber: 1,
        kind: 'ORIGINAL',
        title: note.title,
        sections: { ...note.sections },
        reason: null,
        authorId: note.authorId,
        createdAt: now,
      });
      return HttpResponse.json(apiOk({ note: serializeNote(note) }, 'req_mock_note_finalize'), {
        status: 201,
      });
    }),

    http.post('*/api/v1/clinical-notes/:id/amend', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      const note = LIVE.find((row) => row.id === params.id);
      if (!note) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Clinical note not found'), {
          status: 404,
        });
      }
      if (note.status !== NOTE_STATUS.FINAL) {
        return HttpResponse.json(apiError('INVALID_WORKFLOW_TRANSITION', 'Only FINAL notes are amended.'), {
          status: 409,
        });
      }
      if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'reason required'), { status: 400 });
      }
      const sections = validateSections(body.sections);
      if (!sections) {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'sections invalid'), { status: 400 });
      }
      const lastVersion = note._versions[note._versions.length - 1];
      const versionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;
      const now = new Date().toISOString();
      note.sections = sections;
      note.title =
        typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : note.title;
      note.reason = body.reason.trim();
      note.updatedAt = now;
      note._versions.push({
        id: `cnv_example_${versionSeq++}`,
        versionNumber,
        kind: 'AMENDMENT',
        title: note.title,
        sections: { ...sections },
        reason: body.reason.trim(),
        authorId: note.authorId,
        createdAt: now,
      });
      return HttpResponse.json(apiOk({ note: serializeNote(note) }, 'req_mock_note_amend'), {
        status: 201,
      });
    }),
  ];
}