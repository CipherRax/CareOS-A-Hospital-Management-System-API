import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateCodingSystemSchema = z.object({
  key: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().max(64).optional(),
  kind: z.string().trim().max(64).default('CUSTOM'),
  source: z.string().trim().max(300).optional(),
});
export class CreateCodingSystemDto extends createZodDto(CreateCodingSystemSchema) {}

export const ImportConceptSchema = z.object({
  code: z.string().trim().min(1).max(64),
  display: z.string().trim().min(1).max(300),
  description: z.string().trim().max(1000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const ImportCodingConceptsSchema = z.object({
  concepts: z.array(ImportConceptSchema).nonempty(),
});
export class ImportCodingConceptsDto extends createZodDto(ImportCodingConceptsSchema) {}

export const ListConceptsQuerySchema = z.object({
  query: z.string().trim().max(300).optional(),
  active: z.string().transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListConceptsQueryDto extends createZodDto(ListConceptsQuerySchema) {}

export const ListCodingSystemsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListCodingSystemsQueryDto extends createZodDto(ListCodingSystemsQuerySchema) {}

export const CodingSystemResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  key: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  kind: z.string(),
  source: z.string().nullable(),
  isActive: z.boolean(),
});
export class CodingSystemResponseDto extends createZodDto(CodingSystemResponseSchema) {}

export const CodeConceptResponseSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  code: z.string(),
  display: z.string(),
  description: z.string().nullable(),
  codeSystemKey: z.string(),
  isActive: z.boolean(),
});
export class CodeConceptResponseDto extends createZodDto(CodeConceptResponseSchema) {}

export const CodingImportResultSchema = z.object({
  inserted: z.number(),
  updated: z.number(),
  total: z.number(),
});
export class CodingImportResultDto extends createZodDto(CodingImportResultSchema) {}