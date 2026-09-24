import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ClinicalNoteStatus = z.enum(['DRAFT', 'FINAL']);
export const NoteSectionsRecord = z.record(z.string(), z.string());

export const CreateClinicalNoteSchema = z.object({
  encounterId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  title: z.string().trim().max(200).optional(),
  sections: NoteSectionsRecord.optional(),
});
export class CreateClinicalNoteDto extends createZodDto(CreateClinicalNoteSchema) {}

export const UpdateClinicalNoteSchema = z.object({
  title: z.string().trim().max(200).optional(),
  sections: NoteSectionsRecord.optional(),
});
export class UpdateClinicalNoteDto extends createZodDto(UpdateClinicalNoteSchema) {}

export const FinalizeClinicalNoteSchema = z.object({});
export class FinalizeClinicalNoteDto extends createZodDto(FinalizeClinicalNoteSchema) {}

export const AmendClinicalNoteSchema = z.object({
  sections: NoteSectionsRecord,
  title: z.string().trim().max(200).optional(),
  reason: z.string().trim().min(1).max(500),
});
export class AmendClinicalNoteDto extends createZodDto(AmendClinicalNoteSchema) {}

export const ListClinicalNotesQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  status: ClinicalNoteStatus.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListClinicalNotesQueryDto extends createZodDto(ListClinicalNotesQuerySchema) {}

export const CreateClinicalNoteTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  departmentId: z.string().uuid().optional(),
  sections: z.array(z.string()).nonempty(),
});
export class CreateClinicalNoteTemplateDto extends createZodDto(CreateClinicalNoteTemplateSchema) {}

export const ListClinicalNoteTemplatesQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListClinicalNoteTemplatesQueryDto extends createZodDto(
  ListClinicalNoteTemplatesQuerySchema,
) {}

export const ClinicalNoteResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  patientId: z.string(),
  encounterId: z.string(),
  authorId: z.string(),
  status: ClinicalNoteStatus,
  title: z.string().nullable(),
  sections: NoteSectionsRecord,
  reason: z.string().nullable(),
  templateId: z.string().nullable(),
  finalizedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  versions: z
    .array(
      z.object({
        id: z.string(),
        versionNumber: z.number(),
        kind: z.enum(['ORIGINAL', 'AMENDMENT', 'NEW_VERSION']),
        title: z.string().nullable(),
        sections: NoteSectionsRecord,
        reason: z.string().nullable(),
        authorId: z.string(),
        createdAt: z.date(),
      }),
    )
    .optional(),
});
export class ClinicalNoteResponseDto extends createZodDto(ClinicalNoteResponseSchema) {}

export const ClinicalNoteTemplateResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  departmentId: z.string().nullable(),
  sections: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class ClinicalNoteTemplateResponseDto extends createZodDto(ClinicalNoteTemplateResponseSchema) {}