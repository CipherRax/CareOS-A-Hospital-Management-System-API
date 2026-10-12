import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Clinical notes (F4 — doctor workspace).
 *
 * Same drift as the encounters export (GAP-020): every list handler is typed
 * with `query: never` and a 200 of the request DTO, and every note/template read
 * is typed as the bare response entity while the service answers `{ note }` /
 * `{ template }`. So the list reads ride the raw-fetch path; the single note read
 * and all writes use the typed client for the URL/body and validate the unwrapped
 * `{ note }` structurally.
 *
 * Lifecycle is DRAFT → FINAL (`NOTE_SECTION_KEYS` mirror `note-versioning.ts`).
 * DRAFT is edited in place; finalizing writes the ORIGINAL version; anything
 * later goes through the amendment path, which appends a superseding version and
 * requires a reason. Notes can only be created against an OPEN or IN_PROGRESS
 * encounter — a COMPLETED encounter answers 409 INVALID_WORKFLOW_TRANSITION, and
 * the panel mirrors that by offering creation only while the workspace encounter
 * is open.
 */

export const NOTE_SECTION_KEYS = [
  'chiefComplaint',
  'history',
  'subjective',
  'objective',
  'assessment',
  'plan',
  'instructions',
  'followUp',
] as const;
export type NoteSectionKey = (typeof NOTE_SECTION_KEYS)[number];

export const NOTE_STATUSES = ['DRAFT', 'FINAL'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const NOTE_VERSION_KINDS = ['ORIGINAL', 'AMENDMENT', 'NEW_VERSION'] as const;

/** Structured note body: section key → text. Keys are validated client-side, not trusted. */
export type NoteSections = Readonly<Record<string, string>>;

export interface NoteVersionRow {
  readonly id: string;
  readonly versionNumber: number;
  readonly kind: string;
  readonly title: string | null;
  readonly sections: NoteSections;
  readonly reason: string | null;
  readonly authorId: string;
  readonly createdAt: string;
}

export interface NoteRow {
  readonly id: string;
  readonly organizationId: string;
  readonly patientId: string;
  readonly encounterId: string;
  readonly authorId: string;
  readonly status: string;
  readonly title: string | null;
  readonly sections: NoteSections;
  readonly reason: string | null;
  readonly templateId: string | null;
  readonly finalizedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly NoteVersionRow[] | null;
}

export interface NotePage {
  readonly items: readonly NoteRow[];
  readonly total: number;
}

export interface NoteTemplateRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly departmentId: string | null;
  readonly sections: readonly string[];
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TemplatePage {
  readonly items: readonly NoteTemplateRow[];
  readonly total: number;
}

/** Sections are read leniently — unknown keys render under their own name, so a
 * forward-added section never blanks a note; a non-record of strings is unusable. */
export function readSections(value: unknown): NoteSections | null {
  if (!isRecord(value)) return null;
  const sections: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string') return null;
    sections[key] = text;
  }
  return sections;
}

export function readVersion(value: unknown): NoteVersionRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.versionNumber !== 'number') return null;
  if (typeof value.createdAt !== 'string') return null;
  const sections = readSections(value.sections);
  if (!sections) return null;
  return {
    id: value.id,
    versionNumber: value.versionNumber,
    kind: typeof value.kind === 'string' ? value.kind : 'AMENDMENT',
    title: nullableString(value.title),
    sections,
    reason: nullableString(value.reason),
    authorId: typeof value.authorId === 'string' ? value.authorId : '',
    createdAt: value.createdAt,
  };
}

/** Reads one serialized note; returns null when the row is unusable. */
export function readNote(value: unknown): NoteRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.encounterId !== 'string') return null;
  if (typeof value.patientId !== 'string') return null;
  if (typeof value.status !== 'string') return null;
  if (typeof value.createdAt !== 'string') return null;
  const sections = readSections(value.sections);
  if (!sections) return null;

  let versions: NoteVersionRow[] | null = null;
  if (value.versions !== undefined) {
    if (!Array.isArray(value.versions)) return null;
    const parsed = value.versions.map(readVersion);
    if (parsed.some((version) => version === null)) return null;
    versions = parsed as NoteVersionRow[];
  }

  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    patientId: value.patientId,
    encounterId: value.encounterId,
    authorId: typeof value.authorId === 'string' ? value.authorId : '',
    status: value.status,
    title: nullableString(value.title),
    sections,
    reason: nullableString(value.reason),
    templateId: nullableString(value.templateId),
    finalizedAt: nullableString(value.finalizedAt),
    createdAt: value.createdAt,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : value.createdAt,
    versions,
  };
}

/**
 * Reads the note list from the unwrapped envelope: `data` is the array of notes
 * and `meta` the pagination sibling. A non-array is a broken body; a genuinely
 * empty array is "no notes yet".
 */
export function extractNotePage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: NotePage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readNote);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly NoteRow[], total } };
}

/** Reads a note write body: every note write answers `{ note }`. */
export function extractNoteRecord(
  payload: unknown,
): { ok: true; note: NoteRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const note = readNote(payload.note);
  if (!note) return { ok: false };
  return { ok: true, note };
}

/** Reads the template list from the unwrapped envelope (a flat `data` array). */
export function extractTemplatePage(
  data: unknown,
  meta?: unknown,
): { ok: true; page: TemplatePage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const items = data.map(readTemplate);
  if (items.some((item) => item === null)) return { ok: false };
  const total = pageTotal(meta, items.length);
  return { ok: true, page: { items: items as readonly NoteTemplateRow[], total } };
}

/** Reads a template write body: template writes answer `{ template }`. */
export function extractTemplateRecord(
  payload: unknown,
): { ok: true; template: NoteTemplateRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const template = readTemplate(payload.template);
  if (!template) return { ok: false };
  return { ok: true, template };
}

export function readTemplate(value: unknown): NoteTemplateRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.name !== 'string') return null;
  if (!Array.isArray(value.sections)) return null;
  if (value.sections.some((section) => typeof section !== 'string')) return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    name: value.name,
    description: nullableString(value.description),
    departmentId: nullableString(value.departmentId),
    sections: value.sections as string[],
    isActive: typeof value.isActive === 'boolean' ? value.isActive : true,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

/** Shape every clinical-notes raw call rejects with, matching the query error contract. */
export type ClinicalNotesCallError = EnvelopeCallError;

export interface NoteQuery {
  readonly patientId?: string;
  readonly encounterId?: string;
  readonly status?: string;
}

export interface TemplateQuery {
  readonly departmentId?: string;
}

/**
 * Raw list read against `GET /clinical-notes?…`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO (GAP-020), so this uses the
 * same raw-fetch precedent as every other list in the app.
 */
export async function fetchClinicalNotes(
  query: NoteQuery = {},
  signal?: AbortSignal,
): Promise<NotePage> {
  const suffix = queryString({
    patientId: query.patientId,
    encounterId: query.encounterId,
    status: query.status,
  });
  const url = `${publicEnv.apiBasePath}/clinical-notes${suffix}`;
  const parsed = await readEnvelope<NotePage>(url, (data, meta) => {
    const page = extractNotePage(data, meta);
    return page.ok ? { ok: true, value: page.page } : { ok: false };
  }, signal);
  return parsed;
}

/** Raw list read against `GET /clinical-notes/templates` (same GAP-020 drift). */
export async function fetchNoteTemplates(
  query: TemplateQuery = {},
  signal?: AbortSignal,
): Promise<TemplatePage> {
  const suffix = queryString({ departmentId: query.departmentId });
  const url = `${publicEnv.apiBasePath}/clinical-notes/templates${suffix}`;
  const parsed = await readEnvelope<TemplatePage>(url, (data, meta) => {
    const page = extractTemplatePage(data, meta);
    return page.ok ? { ok: true, value: page.page } : { ok: false };
  }, signal);
  return parsed;
}