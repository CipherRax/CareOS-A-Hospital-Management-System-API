import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Laboratory & radiology (brief Phase 6). Numeric result thresholds live on the
 * configured LabTestField (org-owned), never in code. Response DTOs document
 * the wire format; the transform interceptor unwraps pageOf into
 * `{ success, data, meta }`.
 */

export const LabTestFieldType = z.enum(['NUMERIC', 'TEXT', 'CATEGORICAL']);
export const LabOrderStatus = z.enum([
  'ORDERED',
  'COLLECTED',
  'RECEIVED',
  'PROCESSING',
  'RESULT_READY',
  'VERIFIED',
  'RELEASED',
  'REJECTED',
  'CANCELLED',
]);
export const LabSampleStatus = z.enum([
  'ORDERED',
  'COLLECTED',
  'RECEIVED',
  'PROCESSING',
  'COMPLETED',
  'REJECTED',
]);
export const LabSampleType = z.enum([
  'BLOOD',
  'URINE',
  'STOOL',
  'SWAB',
  'SPUTUM',
  'TISSUE',
  'FLUID',
  'OTHER',
]);
export const LabOrderPriority = z.enum(['ROUTINE', 'URGENT', 'STAT']);

const NestedId = z.string().uuid();
const PageQuery = () => ({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// ─── Catalog: categories ───────────────────────────────────────────────────

export const CreateLabCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});
export class CreateLabCategoryDto extends createZodDto(CreateLabCategorySchema) {}

export const LabCategoryResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class LabCategoryResponseDto extends createZodDto(LabCategoryResponseSchema) {}

// ─── Catalog: tests + fields ────────────────────────────────────────────────

export const TestFieldInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  fieldType: LabTestFieldType.default('NUMERIC'),
  unit: z.string().trim().max(50).optional(),
  referenceMin: z.string().trim().regex(/^-?\d+(\.\d+)?$/).optional(),
  referenceMax: z.string().trim().regex(/^-?\d+(\.\d+)?$/).optional(),
  criticalMin: z.string().trim().regex(/^-?\d+(\.\d+)?$/).optional(),
  criticalMax: z.string().trim().regex(/^-?\d+(\.\d+)?$/).optional(),
  allowsValues: z.string().trim().max(1000).optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const CreateLabTestSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  categoryId: NestedId.optional(),
  sampleType: LabSampleType.optional(),
  specimenInstructions: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
  fields: z.array(TestFieldInputSchema).min(1).max(50),
});
export class CreateLabTestDto extends createZodDto(CreateLabTestSchema) {}

export const UpdateLabTestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  categoryId: NestedId.nullish(),
  sampleType: LabSampleType.optional(),
  specimenInstructions: z.string().trim().max(2000).nullish(),
  isActive: z.boolean().optional(),
  version: z.coerce.number().int().optional(),
});
export class UpdateLabTestDto extends createZodDto(UpdateLabTestSchema) {}

export const UpdateLabFieldSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  unit: z.string().trim().max(50).nullish(),
  referenceMin: z.string().trim().regex(/^-?\d+(\.\d+)?$/).nullish(),
  referenceMax: z.string().trim().regex(/^-?\d+(\.\d+)?$/).nullish(),
  criticalMin: z.string().trim().regex(/^-?\d+(\.\d+)?$/).nullish(),
  criticalMax: z.string().trim().regex(/^-?\d+(\.\d+)?$/).nullish(),
  allowsValues: z.string().trim().max(1000).nullish(),
  displayOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export class UpdateLabFieldDto extends createZodDto(UpdateLabFieldSchema) {}

export const ListLabTestsQuerySchema = z.object({
  categoryId: NestedId.optional(),
  active: z.enum(['true', 'false']).optional(),
  ...PageQuery(),
});
export class ListLabTestsQueryDto extends createZodDto(ListLabTestsQuerySchema) {}

export const LabTestFieldResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  testId: z.string(),
  name: z.string(),
  fieldType: LabTestFieldType,
  unit: z.string().nullable(),
  referenceMin: z.string().nullable(),
  referenceMax: z.string().nullable(),
  criticalMin: z.string().nullable(),
  criticalMax: z.string().nullable(),
  allowsValues: z.string().nullable(),
  displayOrder: z.number(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class LabTestFieldResponseDto extends createZodDto(LabTestFieldResponseSchema) {}

export const LabTestResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  code: z.string(),
  name: z.string(),
  categoryId: z.string().nullable(),
  sampleType: LabSampleType,
  specimenInstructions: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  fields: z.array(LabTestFieldResponseSchema).default([]),
});
export class LabTestResponseDto extends createZodDto(LabTestResponseSchema) {}

// ─── Orders ─────────────────────────────────────────────────────────────────

export const CreateLabOrderSchema = z.object({
  patientId: NestedId,
  branchId: NestedId,
  encounterId: z.string().trim().max(200).optional(),
  priority: LabOrderPriority.optional(),
  clinicalNotes: z.string().trim().max(2000).optional(),
  testIds: z.array(NestedId).min(1).max(50),
  /** Link a rejection → new order; the new sample records the recollection. */
  recollectFromSampleId: NestedId.optional(),
});
export class CreateLabOrderDto extends createZodDto(CreateLabOrderSchema) {}

export const ListLabOrdersQuerySchema = z.object({
  patientId: NestedId.optional(),
  branchId: NestedId.optional(),
  status: LabOrderStatus.optional(),
  ...PageQuery(),
});
export class ListLabOrdersQueryDto extends createZodDto(ListLabOrdersQuerySchema) {}

export const RejectLabOrderSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export class RejectLabOrderDto extends createZodDto(RejectLabOrderSchema) {}

export const CancelLabOrderSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export class CancelLabOrderDto extends createZodDto(CancelLabOrderSchema) {}

export const ResultInputSchema = z.object({
  testFieldId: NestedId,
  value: z.string().trim().min(1).max(2000),
});

export const EnterResultsSchema = z.object({
  comments: z.string().trim().max(2000).optional(),
  results: z.array(ResultInputSchema).min(1).max(200),
});
export class EnterResultsDto extends createZodDto(EnterResultsSchema) {}

export const AmendResultSchema = z.object({
  value: z.string().trim().min(1).max(2000),
  reason: z.string().trim().min(1).max(1000),
});
export class AmendResultDto extends createZodDto(AmendResultSchema) {}

export const AcknowledgeCriticalSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export class AcknowledgeCriticalDto extends createZodDto(AcknowledgeCriticalSchema) {}

export const TatQuerySchema = z.object({
  branchId: NestedId.optional(),
  testId: NestedId.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
export class TatQueryDto extends createZodDto(TatQuerySchema) {}

// ─── Responses ──────────────────────────────────────────────────────────────

export const LabSampleResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  sampleNumber: z.string(),
  orderId: z.string(),
  patientId: z.string(),
  branchId: z.string(),
  sampleType: LabSampleType,
  status: LabSampleStatus,
  collectedById: z.string().nullable(),
  collectedAt: z.date().nullable(),
  receivedById: z.string().nullable(),
  receivedAt: z.date().nullable(),
  processingById: z.string().nullable(),
  processingAt: z.date().nullable(),
  completedById: z.string().nullable(),
  completedAt: z.date().nullable(),
  rejectedAt: z.date().nullable(),
  rejectedReason: z.string().nullable(),
  recollectsFromOrderId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class LabSampleResponseDto extends createZodDto(LabSampleResponseSchema) {}

export const LabResultResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  orderItemId: z.string(),
  testFieldId: z.string(),
  currentVersion: z.number(),
  value: z.string(),
  isAbnormal: z.boolean(),
  isCritical: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  amendments: z.number(),
});
export class LabResultResponseDto extends createZodDto(LabResultResponseSchema) {}

export const CriticalResultResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  resultId: z.string(),
  notifiedToId: z.string(),
  notifiedAt: z.date(),
  acknowledgedById: z.string().nullable(),
  acknowledgedAt: z.date().nullable(),
  escalationAt: z.date().nullable(),
});
export class CriticalResultResponseDto extends createZodDto(
  CriticalResultResponseSchema,
) {}

export const LabOrderResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  orderNumber: z.string(),
  patientId: z.string(),
  branchId: z.string(),
  encounterId: z.string().nullable(),
  status: LabOrderStatus,
  priority: LabOrderPriority,
  clinicalNotes: z.string().nullable(),
  orderedById: z.string().nullable(),
  orderedAt: z.date(),
  rejectionReason: z.string().nullable(),
  cancelledById: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  cancelledReason: z.string().nullable(),
  releasedById: z.string().nullable(),
  releasedAt: z.date().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  sample: LabSampleResponseSchema.nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      testId: z.string(),
      testCode: z.string(),
      testName: z.string(),
      notes: z.string().nullable(),
      results: z.array(LabResultResponseSchema),
    }),
  ),
  criticalResults: z.array(CriticalResultResponseSchema).default([]),
});
export class LabOrderResponseDto extends createZodDto(LabOrderResponseSchema) {}