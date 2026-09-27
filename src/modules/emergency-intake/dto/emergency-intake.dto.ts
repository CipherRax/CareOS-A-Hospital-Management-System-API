import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const callerPhone = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[\d+\s-]+$/, 'Invalid phone number');

export const SubmitEmergencyRequestSchema = z.object({
  // Slug of the PUBLISHED directory listing being asked for help.
  slug: z.string().trim().min(1).max(200),
  callerName: z.string().trim().max(120).optional(),
  callerPhone: callerPhone.optional(),
  description: z.string().trim().max(4000).optional(),
  location: z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      landmark: z.string().trim().max(400).optional(),
    })
    .optional(),
});
export class SubmitEmergencyRequestDto extends createZodDto(SubmitEmergencyRequestSchema) {}

export const TrackEmergencyRequestSchema = z.object({
  token: z.string().trim().min(16).max(512),
});
export class TrackEmergencyRequestDto extends createZodDto(TrackEmergencyRequestSchema) {}

export const CancelEmergencyRequestSchema = TrackEmergencyRequestSchema;
export class CancelEmergencyRequestDto extends createZodDto(CancelEmergencyRequestSchema) {}

export const IntakePolicyUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  autoEscalate: z.boolean().optional(),
  requireDescription: z.boolean().optional(),
  allowAnonymousCaller: z.boolean().optional(),
  // SLA seconds per escalation level. Sub-second values run as milliseconds.
  levelSeconds: z.array(z.number().positive().max(86400)).min(1).max(10).optional(),
  emergencyPhone: z.string().trim().max(40).nullable().optional(),
});
export class IntakePolicyUpdateDto extends createZodDto(IntakePolicyUpdateSchema) {}

export const EmergencyContactUpsertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: callerPhone,
  role: z.string().trim().max(120).optional(),
  order: z.coerce.number().int().positive().max(50),
  notes: z.string().trim().max(1000).optional(),
});
export class EmergencyContactUpsertDto extends createZodDto(EmergencyContactUpsertSchema) {}

export const EmergencyContactPatchSchema = EmergencyContactUpsertSchema.partial().extend({
  active: z.boolean().optional(),
});
export class EmergencyContactPatchDto extends createZodDto(EmergencyContactPatchSchema) {}

export const ListEmergencyRequestsQuerySchema = z.object({
  status: z
    .enum(['RECEIVED', 'ACKNOWLEDGED', 'RESPONDING', 'ESCALATED', 'CLOSED', 'CANCELLED'])
    .optional(),
  branchId: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().max(100000).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export class ListEmergencyRequestsQueryDto extends createZodDto(ListEmergencyRequestsQuerySchema) {}

export const StaffNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});
export class StaffNoteDto extends createZodDto(StaffNoteSchema) {}

export const EmergencyNumberUpsertSchema = z.object({
  country: z.string().trim().min(2).max(4).default('KE'),
  purpose: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
  phone: callerPhone,
  hours: z.string().trim().max(60).optional(),
  public: z.boolean().optional(),
});
export class EmergencyNumberUpsertDto extends createZodDto(EmergencyNumberUpsertSchema) {}

export const PublicNoticeUpsertSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  active: z.boolean().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});
export class PublicNoticeUpsertDto extends createZodDto(PublicNoticeUpsertSchema) {}