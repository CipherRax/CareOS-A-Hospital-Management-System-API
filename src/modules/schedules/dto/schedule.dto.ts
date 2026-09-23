import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DayOfWeek = z.number().int().min(0).max(6);

export const CreateProviderScheduleSchema = z.object({
  providerId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid(),
  dayOfWeek: DayOfWeek,
  startMinutes: z.number().int().min(0).max(1439),
  endMinutes: z.number().int().min(1).max(1440),
  slotDurationMinutes: z.number().int().min(5).max(240),
  capacity: z.number().int().min(1).max(99).default(1),
  isAvailable: z.boolean().default(true),
  note: z.string().trim().max(300).nullish(),
});
export class CreateProviderScheduleDto extends createZodDto(CreateProviderScheduleSchema) {}

export const UpdateProviderScheduleSchema = CreateProviderScheduleSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nothing to update' },
);
export class UpdateProviderScheduleDto extends createZodDto(UpdateProviderScheduleSchema) {}

export const CreateScheduleOverrideSchema = z.object({
  providerId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid(),
  date: z.coerce.date(),
  type: z.enum(['WORKING', 'LEAVE', 'HOLIDAY', 'BLOCKED']),
  startMinutes: z.number().int().min(0).max(1439).nullish(),
  endMinutes: z.number().int().min(1).max(1440).nullish(),
  slotDurationMinutes: z.number().int().min(5).max(240).nullish(),
  capacity: z.number().int().min(1).max(99).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export class CreateScheduleOverrideDto extends createZodDto(CreateScheduleOverrideSchema) {}

export const UpdateScheduleOverrideSchema = CreateScheduleOverrideSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nothing to update' },
);
export class UpdateScheduleOverrideDto extends createZodDto(UpdateScheduleOverrideSchema) {}

export const ListSchedulesQuerySchema = z.object({
  providerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  dayOfWeek: DayOfWeek.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListSchedulesQueryDto extends createZodDto(ListSchedulesQuerySchema) {}

export const ListSlotsQuerySchema = z.object({
  providerId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid(),
  date: z.coerce.date(),
  includePast: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});
export class ListSlotsQueryDto extends createZodDto(ListSlotsQuerySchema) {}