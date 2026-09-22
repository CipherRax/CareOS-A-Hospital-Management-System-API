import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BranchStatus = z.enum(['ACTIVE', 'INACTIVE']);

export const CreateBranchSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(32),
  address: z.string().max(300).optional(),
  phone: z.string().max(32).nullable().optional(),
  email: z.string().email().nullable().optional(),
  operatingHours: z.string().max(200).nullable().optional(),
});
export class CreateBranchDto extends createZodDto(CreateBranchSchema) {}

export const UpdateBranchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    address: z.string().max(300).nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
    email: z.string().email().nullable().optional(),
    operatingHours: z.string().max(200).nullable().optional(),
    status: BranchStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdateBranchDto extends createZodDto(UpdateBranchSchema) {}

export const BranchSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  operatingHours: z.string().nullable(),
  status: BranchStatus,
  createdAt: z.string().datetime(),
});
export const BranchListSchema = z.object({
  branches: z.array(BranchSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export class BranchDto extends createZodDto(BranchSchema) {}
export class BranchListResponseDto extends createZodDto(BranchListSchema) {}
