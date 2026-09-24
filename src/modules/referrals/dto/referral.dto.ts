import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReferralStatus = z.enum(['CREATED', 'SENT', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED']);

export const CreateReferralSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().optional(),
  toDepartmentId: z.string().uuid().optional(),
  toFacilityName: z.string().trim().max(300).optional(),
  toFacilityAddress: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(1).max(2000),
  notes: z.string().trim().max(2000).optional(),
  documentIds: z.array(z.string().uuid()).default([]),
});
export class CreateReferralDto extends createZodDto(CreateReferralSchema) {}

export const ActionReferralSchema = z.object({
  action: z.enum(['send', 'accept', 'reject', 'complete', 'cancel']),
  rejectReason: z.string().trim().max(500).optional(),
  cancelReason: z.string().trim().max(500).optional(),
});
export class ActionReferralDto extends createZodDto(ActionReferralSchema) {}

export const ListReferralsQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  toDepartmentId: z.string().uuid().optional(),
  status: ReferralStatus.optional(),
  toFacilityName: z.string().trim().max(300).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListReferralsQueryDto extends createZodDto(ListReferralsQuerySchema) {}

export const ReferralResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  patientId: z.string(),
  encounterId: z.string().nullable(),
  fromProviderId: z.string(),
  toDepartmentId: z.string().nullable(),
  toFacilityName: z.string().nullable(),
  toFacilityAddress: z.string().nullable(),
  reason: z.string(),
  notes: z.string().nullable(),
  documentIds: z.array(z.string()),
  status: ReferralStatus,
  decidedById: z.string().nullable(),
  sentAt: z.date().nullable(),
  acceptedAt: z.date().nullable(),
  rejectedAt: z.date().nullable(),
  rejectReason: z.string().nullable(),
  completedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  cancelReason: z.string().nullable(),
});
export class ReferralResponseDto extends createZodDto(ReferralResponseSchema) {}