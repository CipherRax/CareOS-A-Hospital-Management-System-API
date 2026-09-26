import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MpesaRequestStatus = z.enum([
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'MISMATCHED',
  'EXPIRED',
  'CANCELLED',
]);

const MoneyInput = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
    message: 'Money must be a decimal amount with up to 2 fraction digits',
  });

const PageQuery = {
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
};

export const InitiateStkPushSchema = z.object({
  invoiceId: z.string().uuid(),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?254|0)[17]\d{8}$/, 'phone must be a Kenyan mobile number (e.g. 254712345678)'),
  amount: MoneyInput,
});
export class InitiateStkPushDto extends createZodDto(InitiateStkPushSchema) {}

export const ListRequestsQuerySchema = z.object({
  status: MpesaRequestStatus.optional(),
  ...PageQuery,
});
export class ListRequestsQueryDto extends createZodDto(ListRequestsQuerySchema) {}

export const ReconcileSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export class ReconcileDto extends createZodDto(ReconcileSchema) {}

export const ListReconciliationsQuerySchema = z.object({
  ...PageQuery,
});
export class ListReconciliationsQueryDto extends createZodDto(
  ListReconciliationsQuerySchema,
) {}

export const ResolveMatchSchema = z.object({
  resolution: z.enum([
    'VERIFIED',
    'CORRECTED',
    'PAID_OUT_OF_BAND',
    'DUPLICATE_REFUNDED',
    'WRITTEN_OFF',
    'ESCALATED',
  ]),
  reason: z.string().trim().min(1).max(2000),
});
export class ResolveMatchDto extends createZodDto(ResolveMatchSchema) {}

export const MpesaRequestResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string().nullable(),
  invoiceId: z.string(),
  patientId: z.string(),
  phone: z.string(),
  amount: z.string(),
  checkoutRequestId: z.string(),
  merchantRequestId: z.string(),
  status: MpesaRequestStatus,
  resultCode: z.string().nullable(),
  resultDesc: z.string().nullable(),
  initiatedById: z.string().nullable(),
  initiatedAt: z.date(),
  callbackReceivedAt: z.date().nullable(),
  confirmedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class MpesaRequestResponseDto extends createZodDto(MpesaRequestResponseSchema) {}

export const ListRequestsResponseSchema = z.object({
  items: z.array(MpesaRequestResponseSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});
export class ListRequestsResponseDto extends createZodDto(ListRequestsResponseSchema) {}

export const StatusQueryResponseSchema = z.object({
  requestId: z.string(),
  status: MpesaRequestStatus,
  resultCode: z.string().nullable(),
  resultDesc: z.string().nullable(),
});
export class StatusQueryResponseDto extends createZodDto(StatusQueryResponseSchema) {}

export const MpesaReconciliationRunResponseSchema = z.object({
  id: z.string(),
  windowFrom: z.date(),
  windowTo: z.date(),
  providerCount: z.number(),
  paymentCount: z.number(),
  matchedCount: z.number(),
  unmatchedCount: z.number(),
  duplicateCount: z.number(),
  amountMismatchCount: z.number(),
  referenceMismatchCount: z.number(),
  runById: z.string().nullable(),
  startedAt: z.date(),
  completedAt: z.date(),
  createdAt: z.date(),
});
export class MpesaReconciliationRunResponseDto extends createZodDto(
  MpesaReconciliationRunResponseSchema,
) {}

export const MpesaReconciliationMatchResponseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  reference: z.string(),
  status: z.enum([
    'MATCHED',
    'UNMATCHED',
    'DUPLICATE',
    'AMOUNT_MISMATCH',
    'REFERENCE_MISMATCH',
  ]),
  expectedAmount: z.string().nullish(),
  providerAmount: z.string().nullish(),
  notes: z.string().nullish(),
  resolution: z.string().nullish(),
  resolutionReason: z.string().nullish(),
  resolvedById: z.string().nullish(),
  resolvedAt: z.date().nullish(),
  createdAt: z.date(),
});
export class MpesaReconciliationMatchResponseDto extends createZodDto(
  MpesaReconciliationMatchResponseSchema,
) {}

export const ReconcileResponseSchema = z.object({
  run: MpesaReconciliationRunResponseSchema,
  matches: z.array(MpesaReconciliationMatchResponseSchema),
});
export class ReconcileResponseDto extends createZodDto(ReconcileResponseSchema) {}

export const ListReconciliationsResponseSchema = z.object({
  items: z.array(MpesaReconciliationRunResponseSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});
export class ListReconciliationsResponseDto extends createZodDto(
  ListReconciliationsResponseSchema,
) {}

export const GetReconciliationResponseSchema = z.object({
  run: MpesaReconciliationRunResponseSchema,
  matches: z.array(MpesaReconciliationMatchResponseSchema),
});
export class GetReconciliationResponseDto extends createZodDto(
  GetReconciliationResponseSchema,
) {}

export const MpesaCallbackResponseSchema = z.object({
  ResultCode: z.string(),
  ResultDesc: z.string(),
});
export class MpesaCallbackResponseDto extends createZodDto(MpesaCallbackResponseSchema) {}