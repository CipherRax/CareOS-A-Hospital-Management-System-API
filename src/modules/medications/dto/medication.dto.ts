import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MedicationCategory = z.enum(['MEDICATION', 'SUPPLY']);

export const CreateMedicationSchema = z.object({
  category: MedicationCategory.default('MEDICATION'),
  name: z.string().trim().min(1).max(200),
  genericName: z.string().trim().min(1).max(200).optional(),
  strength: z.string().trim().min(1).max(100).optional(),
  form: z.string().trim().min(1).max(100).optional(),
  unit: z.string().trim().min(1).max(50).default('unit'),
  sku: z.string().trim().min(1).max(100).optional(),
  barcode: z.string().trim().min(1).max(100).optional(),
  isControlled: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export class CreateMedicationDto extends createZodDto(CreateMedicationSchema) {}

export const UpdateMedicationSchema = CreateMedicationSchema.omit({ name: true }).partial().extend({
  name: z.string().trim().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().nonnegative().optional(),
});
export class UpdateMedicationDto extends createZodDto(UpdateMedicationSchema) {}

export const ListMedicationsQuerySchema = z.object({
  category: MedicationCategory.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  isControlled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListMedicationsQueryDto extends createZodDto(ListMedicationsQuerySchema) {}

export const MedicationResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  category: MedicationCategory,
  name: z.string(),
  genericName: z.string().nullable(),
  strength: z.string().nullable(),
  form: z.string().nullable(),
  unit: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  isControlled: z.boolean(),
  isActive: z.boolean(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class MedicationResponseDto extends createZodDto(MedicationResponseSchema) {}