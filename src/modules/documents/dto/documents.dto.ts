import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DocumentStatus = z.enum(['PENDING_UPLOAD', 'UPLOADED', 'DELETED']);

export const FileName = z
  .string()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('\u0000') && !v.includes('/') && !v.includes('\\'), {
    message: 'fileName must be a plain name, not a path',
  });

export const InitiateUploadSchema = z.object({
  fileName: FileName,
  contentType: z.string().min(1).max(255),
  sizeBytes: z.coerce.number().int().positive().max(2 * 1024 * 1024 * 1024).optional(),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export class InitiateUploadDto extends createZodDto(InitiateUploadSchema) {}

export const DocumentResponseSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nullable(),
  checksumSha256: z.string().nullable(),
  status: DocumentStatus,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  uploadedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class DocumentResponseDto extends createZodDto(DocumentResponseSchema) {}

export const InitiateUploadResponseSchema = z.object({
  document: DocumentResponseSchema,
  upload: z.object({
    method: z.literal('PUT'),
    url: z.string().url(),
    expiresIn: z.number().int().positive(),
  }),
});
export class InitiateUploadResponseDto extends createZodDto(InitiateUploadResponseSchema) {}

export const DownloadResponseSchema = z.object({
  documentId: z.string().uuid(),
  url: z.string().url(),
  expiresIn: z.number().int().positive(),
});
export class DownloadResponseDto extends createZodDto(DownloadResponseSchema) {}

export const ListDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: DocumentStatus.optional(),
});
export class ListDocumentsQueryDto extends createZodDto(ListDocumentsQuerySchema) {}