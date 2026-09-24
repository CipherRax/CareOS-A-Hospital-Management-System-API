import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Radiology (brief §6.8). Imaging vendor calls flow through the no-op seam. */

export const RadiologyOrderStatus = z.enum([
  'ORDERED',
  'SCHEDULED',
  'PERFORMED',
  'REPORTED',
  'VERIFIED',
  'RELEASED',
  'CANCELLED',
]);
export const ImagingModality = z.enum([
  'XRAY',
  'CT',
  'MRI',
  'ULTRASOUND',
  'MAMMOGRAPHY',
  'DEXA',
  'FLUOROSCOPY',
  'OTHER',
]);

const NestedId = z.string().uuid();
const PageQuery = () => ({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const CreateRadiologyOrderSchema = z.object({
  patientId: NestedId,
  branchId: NestedId,
  encounterId: z.string().trim().max(200).optional(),
  modality: ImagingModality,
  region: z.string().trim().max(200).optional(),
  clinicalNotes: z.string().trim().max(2000).optional(),
  requestedAt: z.coerce.date().optional(),
});
export class CreateRadiologyOrderDto extends createZodDto(
  CreateRadiologyOrderSchema,
) {}

export const ListRadiologyOrdersQuerySchema = z.object({
  patientId: NestedId.optional(),
  branchId: NestedId.optional(),
  status: RadiologyOrderStatus.optional(),
  ...PageQuery(),
});
export class ListRadiologyOrdersQueryDto extends createZodDto(
  ListRadiologyOrdersQuerySchema,
) {}

export const CancelRadiologyOrderSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export class CancelRadiologyOrderDto extends createZodDto(
  CancelRadiologyOrderSchema,
) {}

export const SubmitReportSchema = z.object({
  findings: z.string().trim().min(1).max(20_000),
  summary: z.string().trim().max(5000).optional(),
  impression: z.string().trim().max(5000).optional(),
});
export class SubmitReportDto extends createZodDto(SubmitReportSchema) {}

export const ImagingReportResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  orderId: z.string(),
  findings: z.string().nullable(),
  summary: z.string().nullable(),
  impression: z.string().nullable(),
  enteredById: z.string().nullable(),
  enteredAt: z.date().nullable(),
  verifiedById: z.string().nullable(),
  verifiedAt: z.date().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class ImagingReportResponseDto extends createZodDto(
  ImagingReportResponseSchema,
) {}

export const RadiologyOrderResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  orderNumber: z.string(),
  patientId: z.string(),
  branchId: z.string(),
  encounterId: z.string().nullable(),
  modality: ImagingModality,
  region: z.string().nullable(),
  status: RadiologyOrderStatus,
  clinicalNotes: z.string().nullable(),
  orderedById: z.string().nullable(),
  orderedAt: z.date(),
  requestedAt: z.date().nullable(),
  performedById: z.string().nullable(),
  performedAt: z.date().nullable(),
  cancelledById: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  cancelledReason: z.string().nullable(),
  releasedById: z.string().nullable(),
  releasedAt: z.date().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  report: ImagingReportResponseSchema.nullable(),
});
export class RadiologyOrderResponseDto extends createZodDto(
  RadiologyOrderResponseSchema,
) {}