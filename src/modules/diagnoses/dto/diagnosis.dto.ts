import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DiagnosisClassification = z.enum(['PRIMARY', 'SECONDARY', 'SUSPECTED']);
export const DiagnosisStatus = z.enum(['ACTIVE', 'RESOLVED', 'HISTORICAL', 'AMENDED']);

export const CreateDiagnosisSchema = z.object({
  encounterId: z.string().uuid(),
  classification: DiagnosisClassification.default('PRIMARY'),
  /** Coded diagnosis: either codeConceptId OR free text. */
  codeConceptId: z.string().uuid().optional(),
  /** Free-text diagnosis when not coded. */
  text: z.string().trim().min(1).max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  onProblemList: z.boolean().default(true),
});
export class CreateDiagnosisDto extends createZodDto(CreateDiagnosisSchema) {}

export const UpdateDiagnosisSchema = z.object({
  action: z.enum(['resolve', 'classify']),
  /** Required for 'classify'. */
  classification: DiagnosisClassification.optional(),
  resolvedNotes: z.string().trim().max(2000).optional(),
});
export class UpdateDiagnosisDto extends createZodDto(UpdateDiagnosisSchema) {}

export const ListDiagnosesQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  classification: DiagnosisClassification.optional(),
  status: DiagnosisStatus.optional(),
  onProblemList: z.string().transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListDiagnosesQueryDto extends createZodDto(ListDiagnosesQuerySchema) {}

export const DenormalizedDiagnosisResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  patientId: z.string(),
  encounterId: z.string().nullable(),
  providerId: z.string(),
  classification: DiagnosisClassification,
  status: DiagnosisStatus,
  code: z.string().nullable(),
  codeSystemKey: z.string().nullable(),
  codeConceptId: z.string().nullable(),
  description: z.string(),
  notes: z.string().nullable(),
  onProblemList: z.boolean(),
  resolvedAt: z.date().nullable(),
  resolvedById: z.string().nullable(),
  resolvedNotes: z.string().nullable(),
  version: z.number(),
});
export class DenormalizedDiagnosisResponseDto extends createZodDto(DenormalizedDiagnosisResponseSchema) {}