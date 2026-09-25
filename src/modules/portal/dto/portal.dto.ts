import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  FeedbackCategory,
  FeedbackResponseDto,
} from '../../quality/dto/quality.dto';

/**
 * Patient portal (brief Phase 10). All requests are self-scoped to the
 * authenticated patient; the wire DTOs never carry patientId (it is derived
 * from TenantContext.scope.patientId server-side).
 */

const PageQuery = () => ({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const PortalPatientResponseSchema = z.object({
  id: z.string(),
  patientNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.date().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(['ACTIVE', 'MERGED', 'ARCHIVED']),
  createdAt: z.date(),
});
export class PortalPatientResponseDto extends createZodDto(
  PortalPatientResponseSchema,
) {}

export const PortalAppointmentMode = z.enum(['IN_PERSON', 'VIRTUAL']);
export const PortalAppointmentStatus = z.enum([
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);

export const PortalAppointmentResponseSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  providerId: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  mode: PortalAppointmentMode,
  status: PortalAppointmentStatus,
  reason: z.string().nullable(),
});
export class PortalAppointmentResponseDto extends createZodDto(
  PortalAppointmentResponseSchema,
) {}

export const PortalAppointmentsQuerySchema = z.object({
  ...PageQuery(),
});
export class PortalAppointmentsQueryDto extends createZodDto(
  PortalAppointmentsQuerySchema,
) {}

export const PortalLabResultsQuerySchema = z.object({
  ...PageQuery(),
});
export class PortalLabResultsQueryDto extends createZodDto(
  PortalLabResultsQuerySchema,
) {}

export const PortalLabResultResponseSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  itemId: z.string(),
  testId: z.string(),
  testName: z.string().nullable(),
  value: z.string(),
  unit: z.string().nullable(),
  referenceMin: z.string().nullable(),
  referenceMax: z.string().nullable(),
  isAbnormal: z.boolean(),
  isCritical: z.boolean(),
  verifiedAt: z.date().nullable(),
  releasedAt: z.date().nullable(),
});
export class PortalLabResultResponseDto extends createZodDto(
  PortalLabResultResponseSchema,
) {}

export const SubmitPortalFeedbackSchema = z.object({
  branchId: z.string().uuid().optional(),
  category: FeedbackCategory,
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(5000).optional(),
});
export class SubmitPortalFeedbackDto extends createZodDto(
  SubmitPortalFeedbackSchema,
) {}

export { FeedbackResponseDto as PortalFeedbackResponseDto };