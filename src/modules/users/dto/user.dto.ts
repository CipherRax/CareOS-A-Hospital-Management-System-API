import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UserStatus = z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']);

export const CreateUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  otherNames: z.string().max(100).optional(),
  phone: z.string().max(32).optional(),
  roleIds: z.array(z.string().uuid()).min(1).optional(),
  branchIds: z.array(z.string().uuid()).optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
  staff: z
    .object({
      staffNumber: z.string().min(1).max(32),
      professionalTitle: z.string().max(100).optional(),
      specialization: z.string().max(100).optional(),
      employmentStatus: z
        .enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'CONTRACT'])
        .default('ACTIVE'),
      licenseNumber: z.string().max(64).optional(),
    })
    .optional(),
});
export class CreateUserDto extends createZodDto(CreateUserSchema) {}

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: UserStatus.optional(),
  q: z.string().max(100).optional(),
});
export class ListUsersQueryDto extends createZodDto(ListUsersQuerySchema) {}

export const UpdateUserSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    otherNames: z.string().max(100).nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
    status: UserStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}

export const SetUserRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1),
});
export class SetUserRolesDto extends createZodDto(SetUserRolesSchema) {}

export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  otherNames: z.string().nullable(),
  phone: z.string().nullable(),
  status: UserStatus,
  createdAt: z.string().datetime(),
  roles: z.array(z.object({ id: z.string().uuid(), key: z.string(), name: z.string() })),
  staff: z
    .object({
      id: z.string().uuid(),
      staffNumber: z.string(),
      professionalTitle: z.string().nullable(),
      specialization: z.string().nullable(),
      employmentStatus: z.string(),
    })
    .nullable(),
});

export const CreateUserResponseSchema = z.object({
  user: UserResponseSchema,
  inviteToken: z
    .string()
    .optional()
    .describe('Dev/test only; delivered OOB in production'),
});

export const UserListResponseSchema = z.object({
  users: z.array(UserResponseSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export class CreateUserResponseDto extends createZodDto(CreateUserResponseSchema) {}
export class UserListResponseDto extends createZodDto(UserListResponseSchema) {}
