import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AdmissionSource,
  EmergencyDisposition,
  EmergencyPriority,
  EmergencyVisitStatus,
} from '../../inpatient/dto/inpatient.dto';

export {
  AdmissionSource,
  EmergencyDisposition,
  EmergencyPriority,
  EmergencyVisitStatus,
};

const NestedId = z.string().uuid();
const PageQuery = () => ({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const RegisterEmergencyVisitSchema = z.object({
  branchId: NestedId,
  patientId: NestedId,
  arrivedAt: z.coerce.date().optional(),
});
export class RegisterEmergencyVisitDto extends createZodDto(
  RegisterEmergencyVisitSchema,
) {}

export const TriageEmergencyVisitSchema = z.object({
  priority: EmergencyPriority,
  complaint: z.string().trim().max(2000).optional(),
});
export class TriageEmergencyVisitDto extends createZodDto(
  TriageEmergencyVisitSchema,
) {}

export const SetEmergencyPrioritySchema = z.object({
  priority: EmergencyPriority,
});
export class SetEmergencyPriorityDto extends createZodDto(
  SetEmergencyPrioritySchema,
) {}

export const AssessEmergencyVisitSchema = z.object({
  assessment: z.string().trim().max(20_000).optional(),
});
export class AssessEmergencyVisitDto extends createZodDto(
  AssessEmergencyVisitSchema,
) {}

export const TreatEmergencyVisitSchema = z.object({
  treatment: z.string().trim().max(20_000).optional(),
});
export class TreatEmergencyVisitDto extends createZodDto(
  TreatEmergencyVisitSchema,
) {}

export const ReferEmergencyVisitSchema = z.object({
  referredTo: z.string().trim().min(1).max(2000),
  referralNotes: z.string().trim().max(2000).optional(),
});
export class ReferEmergencyVisitDto extends createZodDto(
  ReferEmergencyVisitSchema,
) {}

export const AdmitFromEmergencySchema = z.object({
  bedId: NestedId,
  departmentId: NestedId.optional(),
  provisionalDiagnosis: z.string().trim().max(2000).optional(),
  expectedDischargeAt: z.coerce.date().optional(),
});
export class AdmitFromEmergencyDto extends createZodDto(
  AdmitFromEmergencySchema,
) {}

export const ListEmergencyVisitsQuerySchema = z.object({
  branchId: NestedId.optional(),
  patientId: NestedId.optional(),
  status: EmergencyVisitStatus.optional(),
  priority: EmergencyPriority.optional(),
  ...PageQuery(),
});
export class ListEmergencyVisitsQueryDto extends createZodDto(
  ListEmergencyVisitsQuerySchema,
) {}

export const EmergencyVisitResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  visitNumber: z.string(),
  branchId: z.string(),
  patientId: z.string(),
  status: EmergencyVisitStatus,
  priority: EmergencyPriority.nullable(),
  registeredById: z.string().nullable(),
  arrivedById: z.string().nullable(),
  arrivedAt: z.date(),
  chiefComplaint: z.string().nullable(),
  triagedById: z.string().nullable(),
  triagedAt: z.date().nullable(),
  assessedAt: z.date().nullable(),
  assessment: z.string().nullable(),
  treatmentStartedAt: z.date().nullable(),
  treatment: z.string().nullable(),
  observedAt: z.date().nullable(),
  dispositionAt: z.date().nullable(),
  disposition: EmergencyDisposition.nullable(),
  admittedAdmissionId: z.string().nullable(),
  referredTo: z.string().nullable(),
  referralNotes: z.string().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class EmergencyVisitResponseDto extends createZodDto(
  EmergencyVisitResponseSchema,
) {}

export const EmergencySummaryResponseSchema = z.object({
  period: z.enum(['TODAY']),
  arrivals: z.number(),
  active: z.number(),
  avgMinutesToTriage: z.number(),
  avgMinutesToDisposition: z.number(),
  byPriority: z.record(z.number()),
  byDisposition: z.record(z.number()),
});
export class EmergencySummaryResponseDto extends createZodDto(
  EmergencySummaryResponseSchema,
) {}