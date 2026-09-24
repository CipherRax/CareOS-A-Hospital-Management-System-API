import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Billing & invoicing (brief Phase 7). Money is accepted as a decimal string
 * (or number) and is always surfaced as a string on the wire — see ADR-029
 * (Decimal(12,2), never integer cents).
 */

export const BillableItemCategory = z.enum([
  'CONSULTATION',
  'LAB',
  'RADIOLOGY',
  'PHARMACY',
  'PROCEDURE',
  'ADMISSION',
  'OTHER',
]);

export const InvoiceStatus = z.enum([
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'REFUNDED',
]);

export const PaymentMethod = z.enum([
  'CASH',
  'CARD',
  'MOBILE_MONEY',
  'BANK_TRANSFER',
  'CHEQUE',
  'INSURANCE',
  'OTHER',
]);

export const PaymentStatus = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']);

export const CoverageType = z.enum(['FULL', 'PARTIAL']);

export const ClaimStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'DENIED',
  'PAID',
]);

/** Accepts "1500" / "1500.5" / 1500 and normalizes to a money string. */
export const MoneyInput = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
    message: 'Money must be a decimal amount with up to 2 fraction digits',
  });

const MoneyOptional = MoneyInput.optional();
const NestedId = z.string().uuid();

const PageQuery = () => ({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

// ─── Price-list / billable items ────────────────────────────────────────────

export const CreateBillableItemSchema = z.object({
  branchId: NestedId.optional(),
  category: BillableItemCategory,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  price: MoneyInput,
  insuranceEligible: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export class CreateBillableItemDto extends createZodDto(CreateBillableItemSchema) {}

export const UpdateBillableItemSchema = z.object({
  price: MoneyOptional,
  description: z.string().trim().max(2000).nullish(),
  insuranceEligible: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: z.coerce.number().int().optional(),
});
export class UpdateBillableItemDto extends createZodDto(UpdateBillableItemSchema) {}

export const ListBillableItemsQuerySchema = z.object({
  branchId: NestedId.optional(),
  category: BillableItemCategory.optional(),
  active: z.enum(['true', 'false']).optional(),
  ...PageQuery(),
});
export class ListBillableItemsQueryDto extends createZodDto(ListBillableItemsQuerySchema) {}

export const BillableItemResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string().nullable(),
  category: BillableItemCategory,
  name: z.string(),
  description: z.string().nullable(),
  price: z.string(),
  insuranceEligible: z.boolean(),
  isActive: z.boolean(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class BillableItemResponseDto extends createZodDto(BillableItemResponseSchema) {}

// ─── Invoices ───────────────────────────────────────────────────────────────

export const InvoiceItemInputSchema = z.object({
  billableItemId: NestedId.optional(),
  medicationId: NestedId.optional(),
  description: z.string().trim().max(500).optional(),
  quantity: z.coerce.number().int().positive(),
  unitPrice: MoneyOptional,
  referenceType: z.string().trim().max(100).optional(),
  referenceId: z.string().trim().max(200).optional(),
});
export const InvoiceItemInput = z.array(InvoiceItemInputSchema).min(1).max(100);

export const CreateInvoiceSchema = z.object({
  branchId: NestedId,
  patientId: NestedId,
  visitId: z.string().trim().max(200).optional(),
  encounterId: z.string().trim().max(200).optional(),
  discountAmount: MoneyOptional,
  taxAmount: MoneyOptional,
  dueAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  items: InvoiceItemInput,
});
export class CreateInvoiceDto extends createZodDto(CreateInvoiceSchema) {}

export const ActionInvoiceSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export class ActionInvoiceDto extends createZodDto(ActionInvoiceSchema) {}

export const ListInvoicesQuerySchema = z.object({
  branchId: NestedId.optional(),
  patientId: NestedId.optional(),
  status: InvoiceStatus.optional(),
  ...PageQuery(),
});
export class ListInvoicesQueryDto extends createZodDto(ListInvoicesQuerySchema) {}

export const InvoiceItemResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  invoiceId: z.string(),
  billableItemId: z.string().nullable(),
  medicationId: z.string().nullable(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.string(),
  lineTotal: z.string(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.date(),
});
export class InvoiceItemResponseDto extends createZodDto(InvoiceItemResponseSchema) {}

export const InvoiceResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  patientId: z.string(),
  invoiceNumber: z.string(),
  status: InvoiceStatus,
  visitId: z.string().nullable(),
  encounterId: z.string().nullable(),
  subtotal: z.string(),
  discountAmount: z.string(),
  taxAmount: z.string(),
  total: z.string(),
  balanceDue: z.string(),
  dueAt: z.date().nullable(),
  notes: z.string().nullable(),
  issuedById: z.string().nullable(),
  issuedAt: z.date().nullable(),
  cancelledById: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  cancelReason: z.string().nullable(),
  refundedById: z.string().nullable(),
  refundedAt: z.date().nullable(),
  refundReason: z.string().nullable(),
  version: z.number(),
  items: z.array(InvoiceItemResponseSchema).default([]),
});
export class InvoiceResponseDto extends createZodDto(InvoiceResponseSchema) {}

// ─── Payments ───────────────────────────────────────────────────────────────

export const CreatePaymentSchema = z.object({
  amount: MoneyInput,
  method: PaymentMethod,
  externalReference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
});
export class CreatePaymentDto extends createZodDto(CreatePaymentSchema) {}

export const RefundPaymentSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export class RefundPaymentDto extends createZodDto(RefundPaymentSchema) {}

export const ListPaymentsQuerySchema = z.object({
  invoiceId: NestedId.optional(),
  patientId: NestedId.optional(),
  status: PaymentStatus.optional(),
  method: PaymentMethod.optional(),
  ...PageQuery(),
});
export class ListPaymentsQueryDto extends createZodDto(ListPaymentsQuerySchema) {}

export const PaymentResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  invoiceId: z.string(),
  patientId: z.string(),
  receiptNumber: z.string(),
  amount: z.string(),
  method: PaymentMethod,
  status: PaymentStatus,
  externalReference: z.string().nullable(),
  note: z.string().nullable(),
  recordedById: z.string().nullable(),
  recordedAt: z.date().nullable(),
  refundedById: z.string().nullable(),
  refundedAt: z.date().nullable(),
  refundReason: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class PaymentResponseDto extends createZodDto(PaymentResponseSchema) {}

// ─── Insurance (payers, policies, claims) ───────────────────────────────────

export const CreateInsurancePayerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactPhone: z.string().trim().max(50).optional(),
  email: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
});
export class CreateInsurancePayerDto extends createZodDto(CreateInsurancePayerSchema) {}

export const CreatePatientInsurancePolicySchema = z.object({
  patientId: NestedId,
  payerId: NestedId,
  policyNumber: z.string().trim().min(1).max(100),
  coverageType: CoverageType.optional(),
  coveragePercent: z.coerce.number().int().min(0).max(100).optional(),
  validityStart: z.coerce.date().optional(),
  validityEnd: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});
export class CreatePatientInsurancePolicyDto extends createZodDto(
  CreatePatientInsurancePolicySchema,
) {}

export const ListPoliciesQuerySchema = z.object({
  patientId: NestedId.optional(),
  payerId: NestedId.optional(),
  ...PageQuery(),
});
export class ListPoliciesQueryDto extends createZodDto(ListPoliciesQuerySchema) {}

export const InsurancePayerResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  contactPhone: z.string().nullable(),
  email: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class InsurancePayerResponseDto extends createZodDto(InsurancePayerResponseSchema) {}

export const PatientInsurancePolicyResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  patientId: z.string(),
  payerId: z.string(),
  policyNumber: z.string(),
  coverageType: CoverageType,
  coveragePercent: z.number(),
  validityStart: z.date().nullable(),
  validityEnd: z.date().nullable(),
  isActive: z.boolean(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class PatientInsurancePolicyResponseDto extends createZodDto(
  PatientInsurancePolicyResponseSchema,
) {}

export const CreateClaimSchema = z.object({
  invoiceId: NestedId,
  policyId: NestedId,
  amount: MoneyOptional,
  notes: z.string().trim().max(2000).optional(),
});
export class CreateClaimDto extends createZodDto(CreateClaimSchema) {}

export const ActionClaimSchema = z.object({
  action: z.enum(['submit', 'approve', 'partial_approve', 'deny', 'pay']),
  approvedAmount: MoneyOptional,
  reason: z.string().trim().max(1000).optional(),
});
export class ActionClaimDto extends createZodDto(ActionClaimSchema) {}

export const ListClaimsQuerySchema = z.object({
  invoiceId: NestedId.optional(),
  patientId: NestedId.optional(),
  status: ClaimStatus.optional(),
  ...PageQuery(),
});
export class ListClaimsQueryDto extends createZodDto(ListClaimsQuerySchema) {}

export const InsuranceClaimResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  claimNumber: z.string(),
  invoiceId: z.string(),
  policyId: z.string(),
  patientId: z.string(),
  amount: z.string(),
  status: ClaimStatus,
  notes: z.string().nullable(),
  submittedById: z.string().nullable(),
  submittedAt: z.date().nullable(),
  approvedById: z.string().nullable(),
  approvedAt: z.date().nullable(),
  approvedAmount: z.string().nullable(),
  deniedById: z.string().nullable(),
  deniedAt: z.date().nullable(),
  denyReason: z.string().nullable(),
  paidById: z.string().nullable(),
  paidAt: z.date().nullable(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class InsuranceClaimResponseDto extends createZodDto(InsuranceClaimResponseSchema) {}