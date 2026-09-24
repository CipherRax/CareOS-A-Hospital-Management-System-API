import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EncounterType = z.enum([
  'OUTPATIENT',
  'EMERGENCY',
  'FOLLOW_UP',
  'INPATIENT',
  'TELEMEDICINE',
]);
export const EncounterStatus = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED']);

export const CreateEncounterSchema = z.object({
  patientId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
  type: EncounterType.default('OUTPATIENT'),
  visitId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  note: z.string().trim().max(1000).optional(),
});
export class CreateEncounterDto extends createZodDto(CreateEncounterSchema) {}

export const TransitionEncounterSchema = z.object({
  status: EncounterStatus,
});
export class TransitionEncounterDto extends createZodDto(TransitionEncounterSchema) {}

export const ListEncountersQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  type: EncounterType.optional(),
  status: EncounterStatus.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListEncountersQueryDto extends createZodDto(ListEncountersQuerySchema) {}

export const EncounterResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  departmentId: z.string(),
  patientId: z.string(),
  providerId: z.string().nullable(),
  type: EncounterType,
  status: EncounterStatus,
  visitId: z.string().nullable(),
  appointmentId: z.string().nullable(),
  note: z.string().nullable(),
  openedById: z.string(),
  openedAt: z.date(),
  inProgressAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class EncounterResponseDto extends createZodDto(EncounterResponseSchema) {}