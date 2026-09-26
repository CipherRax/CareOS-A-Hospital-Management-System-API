import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MaintenanceStatus = z.enum([
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const MaintenanceReminderStatus = z.enum(['QUEUED', 'SENT']);

const NestedId = z.string().min(1).max(100);

export const ScheduleMaintenanceSchema = z.object({
  assetId: NestedId,
  scheduledFor: z.coerce.date(),
  serviceProvider: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export class ScheduleMaintenanceDto extends createZodDto(ScheduleMaintenanceSchema) {}

export const UpdateMaintenanceSchema = z.object({
  scheduledFor: z.coerce.date().optional(),
  serviceProvider: z.string().trim().min(1).max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  version: z.coerce.number().int().nonnegative().optional(),
});
export class UpdateMaintenanceDto extends createZodDto(UpdateMaintenanceSchema) {}

export const CompleteMaintenanceSchema = z.object({
  downtimeHours: z.coerce.number().int().nonnegative().optional(),
  cost: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
      message: 'Money must be a decimal amount with up to 2 fraction digits',
    })
    .optional(),
  serviceProvider: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export class CompleteMaintenanceDto extends createZodDto(CompleteMaintenanceSchema) {}

export const ListMaintenanceQuerySchema = z.object({
  assetId: NestedId.optional(),
  status: MaintenanceStatus.optional(),
  upcoming: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListMaintenanceQueryDto extends createZodDto(ListMaintenanceQuerySchema) {}

export const MaintenanceResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  assetId: z.string(),
  status: MaintenanceStatus,
  scheduledFor: z.date(),
  completedAt: z.date().nullable(),
  downtimeHours: z.number().int().nullable(),
  cost: z.string().nullable(),
  serviceProvider: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number(),
  createdById: z.string().nullable(),
  completedById: z.string().nullable(),
  cancelledById: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class MaintenanceResponseDto extends createZodDto(MaintenanceResponseSchema) {}

export const ListRemindersQuerySchema = z.object({
  status: MaintenanceReminderStatus.optional(),
  assetId: NestedId.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListRemindersQueryDto extends createZodDto(ListRemindersQuerySchema) {}

export const ReminderResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  maintenanceId: z.string(),
  dueAt: z.date(),
  status: MaintenanceReminderStatus,
  queuedById: z.string().nullable(),
  queuedAt: z.date(),
  sentAt: z.date().nullable(),
  maintenance: MaintenanceResponseSchema.nullable(),
});
export class ReminderResponseDto extends createZodDto(ReminderResponseSchema) {}