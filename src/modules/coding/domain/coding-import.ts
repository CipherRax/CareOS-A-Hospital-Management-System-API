import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/** One imported concept row as accepted from the operator payload. */
export interface ConceptRowInput {
  code: string;
  display: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Validates an import payload into normalized concept rows. Codes must be
 * non-empty and unique within the payload (per code ignores case/whitespace).
 * Throws VALIDATION_ERROR otherwise. Pure — no I/O, unit-testable.
 */
export function validateConceptRows(input: unknown): ConceptRowInput[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'concepts must be a non-empty array.',
      silent: true,
    });
  }
  const seen = new Map<string, number>();
  const out: ConceptRowInput[] = [];
  for (const row of input) {
    if (typeof row !== 'object' || row === null) throw invalidRow();
    const r = row as Record<string, unknown>;
    if (typeof r.code !== 'string' || r.code.trim().length === 0) throw invalidRow('code');
    if (typeof r.display !== 'string' || r.display.trim().length === 0) throw invalidRow('display');
    if (r.description !== undefined && typeof r.description !== 'string') throw invalidRow('description');
    if (r.metadata !== undefined && (typeof r.metadata !== 'object' || r.metadata === null || Array.isArray(r.metadata))) {
      throw invalidRow('metadata');
    }
    const normalized = r.code.trim();
    const existing = seen.get(normalized);
    if (existing !== undefined) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Duplicate code '${normalized}' at indexes ${existing} and ${out.length}.`,
        silent: true,
      });
    }
    seen.set(normalized, out.length);
    out.push({
      code: normalized,
      display: r.display.trim(),
      description: r.description !== undefined ? String(r.description) : undefined,
      metadata: r.metadata as Record<string, unknown> | undefined,
    });
  }
  return out;
}

function invalidRow(field?: string): AppError {
  return new AppError({
    code: ErrorCodes.VALIDATION_ERROR,
    message: field ? `Invalid or missing '${field}' in a concept row.` : 'Invalid concept row.',
    silent: true,
  });
}