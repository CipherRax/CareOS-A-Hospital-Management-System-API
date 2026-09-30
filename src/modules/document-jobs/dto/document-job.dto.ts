import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DOCUMENT_JOB_KINDS = [
  'invoice',
  'referral',
  'discharge_summary',
  'patient_summary',
] as const;

export const DocumentJobPdfKindSchema = z.enum(DOCUMENT_JOB_KINDS);

/**
 * Columns and cells are accepted as plain JSON values and normalised to
 * strings, so a client can send numbers for a money column without stringifying
 * them first. `null` becomes an empty cell rather than the word "null".
 */
const PdfCellSchema = z
  .union([z.string().max(200), z.number(), z.boolean(), z.null()])
  .transform((value) => (value == null ? '' : String(value)));
/**
 * Bounds on the optional table. These are not arbitrary: a request body is
 * attacker-controlled, and an unbounded row array would let one caller ask the
 * server to lay out tens of thousands of table cells inside a PDF. Charts and
 * images are deliberately *not* accepted over HTTP — the renderer supports them
 * for documents the server builds itself, but neither is worth an upload
 * surface on an endpoint.
 */
const PDF_MAX_COLUMNS = 12;
const PDF_MAX_ROWS = 300;

export const PdfColumnSchema = z.object({
  header: z.string().trim().min(1).max(60),
  weight: z.number().min(0.1).max(20).optional(),
  align: z.enum(['left', 'right']).optional(),
  compact: z.boolean().optional(),
});

export const RenderDocumentPdfSchema = z.object({
  kind: DocumentJobPdfKindSchema,
  resourceId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  lines: z.array(z.string().max(2000)).max(200),
  columns: z.array(PdfColumnSchema).max(PDF_MAX_COLUMNS).optional(),
  rows: z
    .array(z.array(PdfCellSchema).max(PDF_MAX_COLUMNS))
    .max(PDF_MAX_ROWS)
    .optional(),
});
export class RenderDocumentPdfDto extends createZodDto(RenderDocumentPdfSchema) {}
