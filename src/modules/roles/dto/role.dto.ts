import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateRoleSchema = z.object({
  name: z.string().min(1).max(64),
  key: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  description: z.string().max(256).optional(),
  permissions: z.array(z.string()).min(1),
});
export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}

export const UpdateRoleSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    description: z.string().max(256).nullable().optional(),
    permissions: z.array(z.string()).min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdateRoleDto extends createZodDto(UpdateRoleSchema) {}

export const RoleSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  createdAt: z.string().datetime(),
});
export const RoleListSchema = z.object({
  roles: z.array(RoleSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export class RoleDto extends createZodDto(RoleSchema) {}
export class RoleListResponseDto extends createZodDto(RoleListSchema) {}
