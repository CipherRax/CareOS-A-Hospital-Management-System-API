import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Quality (feedback / complaints / incidents) + patient portal (brief Phase 10).
 * Enum schemas mirror prisma/schema.prisma exactly (no runtime @prisma/client
 * value imports in DTOs).
 */

export const FeedbackCategory = z.enum([
  'SERVICE',
  'WAITING_TIME',
  'STAFF',
  'BILLING',
  'FACILITY',
  'PHARMACY',
  'LABORATORY',
  'OTHER',
]);
export const FeedbackStatus = z.enum([
  'NEW',
  'ACKNOWLEDGED',
  'RESOLVED',
  'CLOSED',
]);
export const ComplaintOrigin = z.enum(['PATIENT', 'STAFF', 'OTHER']);
export const ComplaintStatus = z.enum([
  'OPEN',
  'ASSIGNED',
  'INVESTIGATING',
  'RESOLVED',
  'CLOSED',
]);
export const IncidentCategory = z.enum([
  'OUTAGE',
  'EQUIPMENT',
  'STOCK_DISCREPANCY',
  'DATA_ACCESS',
  'FACILITY',
  'PATIENT_SAFETY',
  'OTHER',
]);
export const IncidentSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const IncidentStatus = z.enum([
  'OPEN',
  'INVESTIGATING',
  'ACTION_PLAN',
  'RESOLVED',
  'CLOSED',
]);

const Id = z.string().uuid();
const Comment = z.string().trim().max(5000);

const PageQuery = () => ({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// ─── Feedback ────────────────────────────────────────────────────────────────

export const SubmitFeedbackSchema = z.object({
  branchId: Id.optional(),
  category: FeedbackCategory,
  rating: z.number().int().min(1).max(5),
  comment: Comment.optional(),
  patientId: Id.optional(),
});
export class SubmitFeedbackDto extends createZodDto(SubmitFeedbackSchema) {}

export const RespondFeedbackSchema = z.object({
  status: FeedbackStatus,
  response: z.string().trim().min(1).max(5000).optional(),
});
export class RespondFeedbackDto extends createZodDto(RespondFeedbackSchema) {}

export const ListFeedbackQuerySchema = z.object({
  category: FeedbackCategory.optional(),
  status: FeedbackStatus.optional(),
  ...PageQuery(),
});
export class ListFeedbackQueryDto extends createZodDto(
  ListFeedbackQuerySchema,
) {}

export const FeedbackResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string().nullable(),
  patientId: z.string().nullable(),
  submittedById: z.string().nullable(),
  category: FeedbackCategory,
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  status: FeedbackStatus,
  response: z.string().nullable(),
  handledById: z.string().nullable(),
  handledAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class FeedbackResponseDto extends createZodDto(FeedbackResponseSchema) {}

// ─── Complaints ───────────────────────────────────────────────────────────────

export const CreateComplaintSchema = z.object({
  origin: ComplaintOrigin,
  branchId: Id.optional(),
  patientId: Id.optional(),
  category: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  assignedToId: Id.optional(),
  dueAt: z.coerce.date().optional(),
});
export class CreateComplaintDto extends createZodDto(CreateComplaintSchema) {}

export const UpdateComplaintStatusSchema = z.object({
  status: ComplaintStatus,
  resolution: z.string().trim().max(5000).optional(),
  assignedToId: Id.nullish(),
  dueAt: z.coerce.date().nullish(),
});
export class UpdateComplaintStatusDto extends createZodDto(
  UpdateComplaintStatusSchema,
) {}

export const ListComplaintsQuerySchema = z.object({
  status: ComplaintStatus.optional(),
  assignedToId: Id.optional(),
  ...PageQuery(),
});
export class ListComplaintsQueryDto extends createZodDto(
  ListComplaintsQuerySchema,
) {}

export const ComplaintResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string().nullable(),
  origin: ComplaintOrigin,
  patientId: z.string().nullable(),
  submittedById: z.string().nullable(),
  category: z.string(),
  description: z.string(),
  status: ComplaintStatus,
  assignedToId: z.string().nullable(),
  dueAt: z.date().nullable(),
  resolution: z.string().nullable(),
  closedById: z.string().nullable(),
  closedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class ComplaintResponseDto extends createZodDto(ComplaintResponseSchema) {}

// ─── Incidents ────────────────────────────────────────────────────────────────

export const CreateIncidentSchema = z.object({
  branchId: Id,
  category: IncidentCategory,
  severity: IncidentSeverity,
  description: z.string().trim().min(1).max(5000),
});
export class CreateIncidentDto extends createZodDto(CreateIncidentSchema) {}

export const UpdateIncidentStatusSchema = z.object({
  status: IncidentStatus,
  actionsTaken: z.string().trim().max(5000).optional(),
  resolution: z.string().trim().max(5000).optional(),
});
export class UpdateIncidentStatusDto extends createZodDto(
  UpdateIncidentStatusSchema,
) {}

export const ListIncidentsQuerySchema = z.object({
  status: IncidentStatus.optional(),
  severity: IncidentSeverity.optional(),
  category: IncidentCategory.optional(),
  ...PageQuery(),
});
export class ListIncidentsQueryDto extends createZodDto(
  ListIncidentsQuerySchema,
) {}

export const IncidentResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  category: IncidentCategory,
  severity: IncidentSeverity,
  description: z.string(),
  reportedById: z.string(),
  status: IncidentStatus,
  actionsTaken: z.string().nullable(),
  resolution: z.string().nullable(),
  resolvedById: z.string().nullable(),
  resolvedAt: z.date().nullable(),
  closedById: z.string().nullable(),
  closedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class IncidentResponseDto extends createZodDto(IncidentResponseSchema) {}