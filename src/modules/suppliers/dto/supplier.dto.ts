import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  email: z.string().trim().email().max(320).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  taxNumber: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().default(true),
});
export class CreateSupplierDto extends createZodDto(CreateSupplierSchema) {}

export const UpdateSupplierSchema = CreateSupplierSchema.partial().extend({});
export class UpdateSupplierDto extends createZodDto(UpdateSupplierSchema) {}

export const ListSuppliersQuerySchema = z.object({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListSuppliersQueryDto extends createZodDto(ListSuppliersQuerySchema) {}

export const SupplierResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  taxNumber: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class SupplierResponseDto extends createZodDto(SupplierResponseSchema) {}