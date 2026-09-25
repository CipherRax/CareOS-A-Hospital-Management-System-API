import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const VirtualSessionStatus = z.enum([
  'SCHEDULED',
  'STARTED',
  'ENDED',
  'CANCELLED',
  'NO_SHOW',
]);

export const ScheduleVirtualSessionSchema = z.object({
  branchId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  patientId: z.string().uuid(),
  providerId: z.string().uuid(),
  scheduledStartAt: z.coerce.date(),
  scheduledEndAt: z.coerce.date().optional(),
});
export class ScheduleVirtualSessionDto extends createZodDto(
  ScheduleVirtualSessionSchema,
) {}

export const ListVirtualSessionsQuerySchema = z.object({
  status: VirtualSessionStatus.optional(),
  providerId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListVirtualSessionsQueryDto extends createZodDto(
  ListVirtualSessionsQuerySchema,
) {}

export const CancelVirtualSessionSchema = z.object({
  cancelReason: z.string().trim().min(1).max(500),
});
export class CancelVirtualSessionDto extends createZodDto(CancelVirtualSessionSchema) {}

export const VirtualSessionResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  appointmentId: z.string().nullable(),
  patientId: z.string(),
  providerId: z.string(),
  status: VirtualSessionStatus,
  consentRecorded: z.boolean(),
  consentId: z.string().nullable(),
  meetingRef: z.string().nullable(),
  scheduledStartAt: z.date(),
  scheduledEndAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  cancelledById: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class VirtualSessionResponseDto extends createZodDto(
  VirtualSessionResponseSchema,
) {}

export const VirtualSessionListResponseSchema = z.object({
  items: z.array(VirtualSessionResponseSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export class VirtualSessionListResponseDto extends createZodDto(
  VirtualSessionListResponseSchema,
) {}
