import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DepartmentKind = z.enum(['STANDARD', 'CUSTOM']);

export const CreateDepartmentSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(32).optional(),
  kind: DepartmentKind.default('STANDARD'),
});
export class CreateDepartmentDto extends createZodDto(CreateDepartmentSchema) {}

export const UpdateDepartmentSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    code: z.string().min(1).max(32).nullable().optional(),
    kind: DepartmentKind.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdateDepartmentDto extends createZodDto(UpdateDepartmentSchema) {}

export const DepartmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  kind: DepartmentKind,
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export const DepartmentListSchema = z.object({
  departments: z.array(DepartmentSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export class DepartmentDto extends createZodDto(DepartmentSchema) {}
export class DepartmentListResponseDto extends createZodDto(DepartmentListSchema) {}
