import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PrescriptionStatus = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_DISPENSED',
  'DISPENSED',
  'CANCELLED',
]);

export const PrescriptionItemSchema = z.object({
  medicationId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  dosage: z.string().trim().max(200).optional(),
  frequency: z.string().trim().max(200).optional(),
  durationDays: z.coerce.number().int().positive().optional(),
  instructions: z.string().trim().max(2000).optional(),
});

export const CreatePrescriptionSchema = z.object({
  patientId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(PrescriptionItemSchema).min(1).max(100),
});
export class CreatePrescriptionDto extends createZodDto(CreatePrescriptionSchema) {}

export const ActionPrescriptionSchema = z.object({
  action: z.enum(['issue', 'cancel']),
  cancelReason: z.string().trim().max(500).optional(),
});
export class ActionPrescriptionDto extends createZodDto(ActionPrescriptionSchema) {}

export const ListPrescriptionsQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  status: PrescriptionStatus.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListPrescriptionsQueryDto extends createZodDto(ListPrescriptionsQuerySchema) {}

export const PrescriptionResponseItemSchema = z.object({
  id: z.string(),
  medicationId: z.string(),
  quantity: z.number(),
  dispensedQuantity: z.number(),
  dosage: z.string().nullable(),
  frequency: z.string().nullable(),
  durationDays: z.number().nullable(),
  instructions: z.string().nullable(),
});
export class PrescriptionResponseItemDto extends createZodDto(PrescriptionResponseItemSchema) {}

export const PrescriptionResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  patientId: z.string(),
  providerId: z.string(),
  status: PrescriptionStatus,
  notes: z.string().nullable(),
  issuedById: z.string().nullable(),
  issuedAt: z.date().nullable(),
  dispensedAt: z.date().nullable(),
  cancelledById: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number(),
  items: z.array(PrescriptionResponseItemSchema),
});
export class PrescriptionResponseDto extends createZodDto(PrescriptionResponseSchema) {}