import type { ClinicalNoteStatus } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';
import type { Prisma } from '@prisma/client';

/**
 * Clinical note lifecycle (brief §6.6): DRAFT → FINAL. Once FINAL the note is
 * locked to direct edits; changes MUST go through the amendment path, which
 * appends a superseding ClinicalNoteVersion (Original → Amendment → New
 * Version) and updates the note's working snapshot. Nothing is ever deleted.
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

export type NoteSections = Prisma.JsonObject;

const SECTION_KEY_SET: ReadonlySet<string> = new Set(NOTE_SECTION_KEYS);

/** Validates structured sections; throws VALIDATION_ERROR on bad input. */
export function validateNoteSections(input: unknown): NoteSections {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalidSections();
  }
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).length === 0) throw invalidSections();
  for (const [key, value] of Object.entries(obj)) {
    if (!SECTION_KEY_SET.has(key)) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown note section '${key}'. Allowed: ${NOTE_SECTION_KEYS.join(', ')}`,
        silent: true,
      });
    }
    if (typeof value !== 'string') {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Section '${key}' must be text.`,
        silent: true,
      });
    }
  }
  return obj as NoteSections;
}

export function assertNoteStatus(expected: ClinicalNoteStatus, actual: ClinicalNoteStatus): void {
  if (actual !== expected) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `This note is ${actual}; expected ${expected}.`,
      silent: true,
    });
  }
}

export function nextVersionNumber(existing: readonly number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

function invalidSections(): AppError {
  return new AppError({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'sections must be a non-empty object of note sections.',
    silent: true,
  });
}