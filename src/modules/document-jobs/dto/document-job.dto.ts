import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DOCUMENT_JOB_KINDS = [
  'invoice',
  'referral',
  'discharge_summary',
  'patient_summary',
] as const;

export const DocumentJobPdfKindSchema = z.enum(DOCUMENT_JOB_KINDS);
export const RenderDocumentPdfSchema = z.object({
  kind: DocumentJobPdfKindSchema,
  resourceId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  lines: z.array(z.string().max(2000)).max(200),
});
export class RenderDocumentPdfDto extends createZodDto(RenderDocumentPdfSchema) {}
