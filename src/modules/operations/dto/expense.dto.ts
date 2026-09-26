import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Money: accepts "1500" / "1500.5" / 1500 and normalizes to a money string (ADR-029). */
const MoneyInput = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
    message: 'Money must be a decimal amount with up to 2 fraction digits',
  });

export const ExpenseCategory = z.enum([
  'SUPPLIES',
  'EQUIPMENT',
  'MAINTENANCE',
  'UTILITIES',
  'RENT',
  'SALARIES_AND_BENEFITS',
  'TRANSPORT',
  'FOOD_AND_NUTRITION',
  'TELECOMMUNICATIONS',
  'MARKETING',
  'OTHER',
]);

export const ExpenseStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

export const ExpensePaymentStatus = z.enum(['UNPAID', 'PAID']);

const NestedId = z.string().min(1).max(100);

export const CreateExpenseSchema = z.object({
  branchId: NestedId,
  departmentId: NestedId.optional(),
  supplierId: NestedId.optional(),
  category: ExpenseCategory,
  description: z.string().trim().min(1).max(2000).optional(),
  reference: z.string().trim().min(1).max(200).optional(),
  amount: MoneyInput,
});
export class CreateExpenseDto extends createZodDto(CreateExpenseSchema) {}

/** DRAFT-only content edits. Fields may be cleared by passing null. */
export const UpdateExpenseSchema = z.object({
  branchId: NestedId.optional(),
  departmentId: NestedId.nullable().optional(),
  supplierId: NestedId.nullable().optional(),
  category: ExpenseCategory.optional(),
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  reference: z.string().trim().min(1).max(200).nullable().optional(),
  amount: MoneyInput.optional(),
  // Optimistic concurrency: pass the version you last read.
  version: z.coerce.number().int().nonnegative().optional(),
});
export class UpdateExpenseDto extends createZodDto(UpdateExpenseSchema) {}

export const ListExpensesQuerySchema = z.object({
  status: ExpenseStatus.optional(),
  paymentStatus: ExpensePaymentStatus.optional(),
  category: ExpenseCategory.optional(),
  branchId: NestedId.optional(),
  supplierId: NestedId.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListExpensesQueryDto extends createZodDto(ListExpensesQuerySchema) {}

export const RejectExpenseSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export class RejectExpenseDto extends createZodDto(RejectExpenseSchema) {}

export const ExpenseResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  departmentId: z.string().nullable(),
  supplierId: z.string().nullable(),
  expenseNumber: z.string(),
  category: ExpenseCategory,
  description: z.string().nullable(),
  reference: z.string().nullable(),
  amount: z.string(),
  status: ExpenseStatus,
  paymentStatus: ExpensePaymentStatus,
  version: z.number(),
  createdById: z.string(),
  submittedById: z.string().nullable(),
  approvedById: z.string().nullable(),
  rejectedById: z.string().nullable(),
  rejectReason: z.string().nullable(),
  paidById: z.string().nullable(),
  submittedAt: z.date().nullable(),
  approvedAt: z.date().nullable(),
  rejectedAt: z.date().nullable(),
  paidAt: z.date().nullable(),
  cancelledById: z.string().nullable(),
  cancelledAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class ExpenseResponseDto extends createZodDto(ExpenseResponseSchema) {}