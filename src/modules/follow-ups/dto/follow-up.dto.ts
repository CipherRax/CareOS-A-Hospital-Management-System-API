import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FollowUpStatus = z.enum(['SCHEDULED', 'REMINDED', 'COMPLETED', 'MISSED', 'CANCELLED']);

export const CreateFollowUpSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  dueAt: z.coerce.date(),
  reason: z.string().trim().max(500).optional(),
  instructions: z.string().trim().max(1000).optional(),
});
export class CreateFollowUpDto extends createZodDto(CreateFollowUpSchema) {}

export const TransitionFollowUpSchema = z.object({
  action: z.enum(['complete', 'cancel']),
  completedNotes: z.string().trim().max(1000).optional(),
  cancelReason: z.string().trim().max(500).optional(),
});
export class TransitionFollowUpDto extends createZodDto(TransitionFollowUpSchema) {}

export const ListFollowUpsQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  status: FollowUpStatus.optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListFollowUpsQueryDto extends createZodDto(ListFollowUpsQuerySchema) {}

export const FollowUpResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  patientId: z.string(),
  encounterId: z.string().nullable(),
  providerId: z.string().nullable(),
  departmentId: z.string().nullable(),
  dueAt: z.date(),
  reason: z.string().nullable(),
  instructions: z.string().nullable(),
  status: FollowUpStatus,
  createdById: z.string(),
  remindedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  completedNotes: z.string().nullable(),
  missedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  cancelReason: z.string().nullable(),
});
export class FollowUpResponseDto extends createZodDto(FollowUpResponseSchema) {}