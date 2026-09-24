import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TaskStatus = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const TaskPriority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
  priority: TaskPriority.default('NORMAL'),
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
});
export class CreateTaskDto extends createZodDto(CreateTaskSchema) {}

export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  priority: TaskPriority.optional(),
  assignedUserId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
});
export class UpdateTaskDto extends createZodDto(UpdateTaskSchema) {}

export const TransitionTaskSchema = z.object({
  action: z.enum(['start', 'complete', 'cancel']),
  cancelReason: z.string().trim().max(500).optional(),
});
export class TransitionTaskDto extends createZodDto(TransitionTaskSchema) {}

export const ListTasksQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  priority: TaskPriority.optional(),
  status: TaskStatus.optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListTasksQueryDto extends createZodDto(ListTasksQuerySchema) {}

export const TaskResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: TaskPriority,
  status: TaskStatus,
  assignedUserId: z.string().nullable(),
  patientId: z.string().nullable(),
  encounterId: z.string().nullable(),
  dueAt: z.date().nullable(),
  createdById: z.string(),
  completedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  cancelReason: z.string().nullable(),
});
export class TaskResponseDto extends createZodDto(TaskResponseSchema) {}