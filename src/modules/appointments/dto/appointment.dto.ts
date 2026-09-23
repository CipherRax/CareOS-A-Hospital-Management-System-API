import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AppointmentMode = z.enum(['IN_PERSON', 'VIRTUAL']);
export const AppointmentStatus = z.enum([
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);
export const WaitlistStatus = z.enum([
  'WAITING',
  'OFFERED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'REMOVED',
]);

export const BookAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  providerId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid(),
  startsAt: z.coerce.date(),
  mode: AppointmentMode.default('IN_PERSON'),
  appointmentType: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(1000).optional(),
});
export class BookAppointmentDto extends createZodDto(BookAppointmentSchema) {}

export const RescheduleAppointmentSchema = z.object({
  startsAt: z.coerce.date(),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().max(500).optional(),
});
export class RescheduleAppointmentDto extends createZodDto(RescheduleAppointmentSchema) {}

export const CancelAppointmentSchema = z.object({
  version: z.number().int().nonnegative().optional(),
  reason: z.string().trim().max(500).optional(),
});
export class CancelAppointmentDto extends createZodDto(CancelAppointmentSchema) {}

/** Transitions are explicitly not permitted to target BOOKED or RESCHEDULED. */
export const AppointmentStatusTransition = z.enum([
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

export const UpdateAppointmentStatusSchema = z.object({
  status: AppointmentStatusTransition,
  version: z.number().int().nonnegative().optional(),
  reason: z.string().trim().max(500).optional(),
});
export class UpdateAppointmentStatusDto extends createZodDto(UpdateAppointmentStatusSchema) {}

export const ListAppointmentsQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  status: AppointmentStatus.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListAppointmentsQueryDto extends createZodDto(ListAppointmentsQuerySchema) {}

// --- waitlist ---

export const JoinWaitlistSchema = z.object({
  patientId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
  preferredDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});
export class JoinWaitlistDto extends createZodDto(JoinWaitlistSchema) {}

export const ListWaitlistQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  status: WaitlistStatus.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListWaitlistQueryDto extends createZodDto(ListWaitlistQuerySchema) {}

export const AcceptWaitlistOfferSchema = z.object({
  appointmentId: z.string().uuid().optional(),
});
export class AcceptWaitlistOfferDto extends createZodDto(AcceptWaitlistOfferSchema) {}