import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const OperationalPriority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const QueueStatus = z.enum([
  'WAITING',
  'CALLED',
  'IN_SERVICE',
  'COMPLETED',
  'NO_SHOW',
  'ABANDONED',
  'CANCELLED',
  'TRANSFERRED',
]);
export const VisitSource = z.enum(['WALK_IN', 'APPOINTMENT', 'EMERGENCY']);
export const VisitStatus = z.enum([
  'REGISTERED',
  'CHECKED_IN',
  'WAITING',
  'TRIAGE',
  'WAITING_FOR_PROVIDER',
  'CONSULTATION',
  'LAB',
  'RADIOLOGY',
  'PHARMACY',
  'BILLING',
  'COMPLETED',
]);

export const RegisterWalkInSchema = z.object({
  patientId: z.string().uuid(),
  departmentId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  source: VisitSource.default('WALK_IN'),
  priority: OperationalPriority.default('NORMAL'),
  note: z.string().trim().max(300).optional(),
});
export class RegisterWalkInDto extends createZodDto(RegisterWalkInSchema) {}

export const CreateQueueEntrySchema = z.object({
  patientId: z.string().uuid(),
  departmentId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  priority: OperationalPriority.default('NORMAL'),
  note: z.string().trim().max(300).optional(),
});
export class CreateQueueEntryDto extends createZodDto(CreateQueueEntrySchema) {}

export const UpdateQueueEntryStatusSchema = z.object({
  status: QueueStatus,
  reason: z.string().trim().max(300).optional(),
  transferredToDepartmentId: z.string().uuid().optional(),
  transferredToBranchId: z.string().uuid().optional(),
});
export class UpdateQueueEntryStatusDto extends createZodDto(UpdateQueueEntryStatusSchema) {}

export const UpdateQueuePrioritySchema = z.object({
  operationalPriority: OperationalPriority,
  reason: z.string().trim().max(300).optional(),
});
export class UpdateQueuePriorityDto extends createZodDto(UpdateQueuePrioritySchema) {}

export const UpdateVisitStatusSchema = z.object({
  status: VisitStatus,
  reason: z.string().trim().max(300).optional(),
});
export class UpdateVisitStatusDto extends createZodDto(UpdateVisitStatusSchema) {}

export const ListQueueQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  status: QueueStatus.optional(),
  queueDate: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListQueueQueryDto extends createZodDto(ListQueueQuerySchema) {}