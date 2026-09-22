import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateStaffSchema = z
  .object({
    professionalTitle: z.string().max(100).nullable().optional(),
    specialization: z.string().max(100).nullable().optional(),
    employmentStatus: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'CONTRACT']).optional(),
    licenseNumber: z.string().max(64).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdateStaffDto extends createZodDto(UpdateStaffSchema) {}

export const SetStaffAssignmentsSchema = z.object({
  branchIds: z.array(z.string().uuid()).optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
});
export class SetStaffAssignmentsDto extends createZodDto(SetStaffAssignmentsSchema) {}

export const StaffSchema = z.object({
  id: z.string().uuid(),
  staffNumber: z.string(),
  professionalTitle: z.string().nullable(),
  specialization: z.string().nullable(),
  employmentStatus: z.string(),
  licenseNumber: z.string().nullable(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    status: z.string(),
  }),
  branches: z.array(
    z.object({ id: z.string().uuid(), name: z.string(), code: z.string() }),
  ),
  departments: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
export const StaffListResponseSchema = z.object({
  staff: z.array(StaffSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export class StaffDto extends createZodDto(StaffSchema) {}
export class StaffListResponseDto extends createZodDto(StaffListResponseSchema) {}
