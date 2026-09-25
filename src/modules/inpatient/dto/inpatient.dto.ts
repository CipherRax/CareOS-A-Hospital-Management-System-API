import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Inpatient & emergency (brief §6.9). */
import { MANUAL_BED_STATUSES } from '../domain/inpatient-flow';

export const BedStatus = z.enum([
  'AVAILABLE',
  'OCCUPIED',
  'RESERVED',
  'CLEANING',
  'MAINTENANCE',
  'BLOCKED',
]);
export const ManualBedStatus = z.enum(MANUAL_BED_STATUSES);
export const AdmissionSource = z.enum([
  'EMERGENCY',
  'OUTPATIENT_CLINIC',
  'REFERRAL',
  'PLANNED',
  'DIRECT',
]);
export const AdmissionStatus = z.enum(['ADMITTED', 'DISCHARGED']);
export const EmergencyVisitStatus = z.enum([
  'ARRIVED',
  'TRIAGED',
  'ASSESSED',
  'IN_TREATMENT',
  'OBSERVATION',
  'DISCHARGED',
  'ADMITTED',
  'REFERRED',
]);
export const EmergencyPriority = z.enum([
  'RESUSCITATION',
  'EMERGENT',
  'URGENT',
  'SEMI_URGENT',
  'NON_URGENT',
]);
export const EmergencyDisposition = z.enum(['ADMITTED', 'REFERRED', 'DISCHARGED']);

const NestedId = z.string().uuid();
const PageQuery = () => ({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// --- wards / rooms / beds ---------------------------------------------------

export const CreateWardSchema = z.object({
  branchId: NestedId,
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(50).optional(),
  floor: z.string().trim().max(50).optional(),
  description: z.string().trim().max(2000).optional(),
});
export class CreateWardDto extends createZodDto(CreateWardSchema) {}

export const UpdateWardSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  code: z.string().trim().max(50).optional(),
  floor: z.string().trim().max(50).optional(),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
});
export class UpdateWardDto extends createZodDto(UpdateWardSchema) {}

export const CreateRoomSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});
export class CreateRoomDto extends createZodDto(CreateRoomSchema) {}

export const CreateBedSchema = z.object({
  bedNumber: z.string().trim().min(1).max(50),
});
export class CreateBedDto extends createZodDto(CreateBedSchema) {}

export const SetBedStatusSchema = z.object({
  status: ManualBedStatus,
  version: z.number().int().min(0),
});
export class SetBedStatusDto extends createZodDto(SetBedStatusSchema) {}

export const ListWardsQuerySchema = z.object({
  branchId: NestedId.optional(),
  active: z.coerce.boolean().optional(),
  ...PageQuery(),
});
export class ListWardsQueryDto extends createZodDto(ListWardsQuerySchema) {}

export const ListBedsQuerySchema = z.object({
  branchId: NestedId.optional(),
  wardId: NestedId.optional(),
  status: BedStatus.optional(),
  ...PageQuery(),
});
export class ListBedsQueryDto extends createZodDto(ListBedsQuerySchema) {}

// --- admissions -------------------------------------------------------------

export const CreateAdmissionSchema = z.object({
  patientId: NestedId,
  branchId: NestedId,
  bedId: NestedId,
  departmentId: NestedId.optional(),
  encounterId: z.string().trim().max(200).optional(),
  provisionalDiagnosis: z.string().trim().max(2000).optional(),
  expectedDischargeAt: z.coerce.date().optional(),
});
export class CreateAdmissionDto extends createZodDto(CreateAdmissionSchema) {}

export const TransferAdmissionSchema = z.object({
  toBedId: NestedId,
  reason: z.string().trim().max(2000).optional(),
});
export class TransferAdmissionDto extends createZodDto(TransferAdmissionSchema) {}

export const DischargeAdmissionSchema = z.object({
  summary: z.string().trim().max(20_000).optional(),
  instructions: z.string().trim().max(20_000).optional(),
  medications: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        dose: z.string().trim().max(200),
        instructions: z.string().trim().max(1000).optional(),
      }),
    )
    .optional(),
  followUp: z
    .object({
      type: z.string().trim().min(1).max(200),
      date: z.coerce.date().optional(),
      notes: z.string().trim().max(2000).optional(),
    })
    .optional(),
  hasOutstandingBilling: z.boolean().optional(),
  documentIds: z.array(z.string().min(1).max(200)).optional(),
  dischargedAt: z.coerce.date().optional(),
});
export class DischargeAdmissionDto extends createZodDto(
  DischargeAdmissionSchema,
) {}

export const ListAdmissionsQuerySchema = z.object({
  patientId: NestedId.optional(),
  branchId: NestedId.optional(),
  status: AdmissionStatus.optional(),
  ...PageQuery(),
});
export class ListAdmissionsQueryDto extends createZodDto(
  ListAdmissionsQuerySchema,
) {}

// --- response shapes --------------------------------------------------------

export const BedResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  roomId: z.string(),
  bedNumber: z.string(),
  status: BedStatus,
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class BedResponseDto extends createZodDto(BedResponseSchema) {}

export const RoomResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  wardId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  beds: z.array(BedResponseSchema),
});
export class RoomResponseDto extends createZodDto(RoomResponseSchema) {}

export const WardResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  floor: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  rooms: z.array(RoomResponseSchema),
});
export class WardResponseDto extends createZodDto(WardResponseSchema) {}

export const BedAssignmentResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  bedId: z.string(),
  admissionId: z.string(),
  assignedById: z.string(),
  assignedAt: z.date(),
  releasedById: z.string().nullable(),
  releasedAt: z.date().nullable(),
  reason: z.string().nullable(),
  createdAt: z.date(),
});
export class BedAssignmentResponseDto extends createZodDto(
  BedAssignmentResponseSchema,
) {}

export const DischargeResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  admissionId: z.string(),
  dischargedById: z.string().nullable(),
  dischargedAt: z.date(),
  summary: z.string().nullable(),
  instructions: z.string().nullable(),
  medications: z.unknown().nullable(),
  followUp: z.unknown().nullable(),
  hasOutstandingBilling: z.boolean(),
  documentIds: z.unknown().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class DischargeResponseDto extends createZodDto(DischargeResponseSchema) {}

export const AdmissionResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  admissionNumber: z.string(),
  patientId: z.string(),
  branchId: z.string(),
  departmentId: z.string().nullable(),
  encounterId: z.string().nullable(),
  source: AdmissionSource,
  status: AdmissionStatus,
  admittedById: z.string().nullable(),
  admittedAt: z.date(),
  expectedDischargeAt: z.date().nullable(),
  provisionalDiagnosis: z.string().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  assignments: z.array(BedAssignmentResponseSchema),
  discharge: DischargeResponseSchema.nullable(),
});
export class AdmissionResponseDto extends createZodDto(AdmissionResponseSchema) {}