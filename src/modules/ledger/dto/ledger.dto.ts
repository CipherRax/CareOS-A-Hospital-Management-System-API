import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Financial ledger (repo Phase 11). Money is a decimal string on the wire
 * (ADR-029). Dates are ISO-8601 date-time strings. Journal lines are
 * single-side (debit XOR credit).
 */

export const AccountCategory = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export const AccountNormalBalance = z.enum(['DEBIT', 'CREDIT']);
export const FinancialPeriodStatus = z.enum(['OPEN', 'CLOSED', 'LOCKED']);
export const FinanceTransactionStatus = z.enum(['POSTED', 'REVERSED']);

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

// ─── Accounts ───────────────────────────────────────────────────────────────

export const CreateAccountSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(6)
    .regex(/^\d+$/, 'Account code must be digits only'),
  name: z.string().trim().min(1).max(200),
  category: AccountCategory,
  normalBalance: AccountNormalBalance,
  description: z.string().trim().max(1000).optional(),
});
export class CreateAccountDto extends createZodDto(CreateAccountSchema) {}

export const UpdateAccountSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().optional(),
  version: z.coerce.number().int().min(0).optional(),
});
export class UpdateAccountDto extends createZodDto(UpdateAccountSchema) {}

export const ListAccountsQuerySchema = z.object({
  category: AccountCategory.optional(),
  active: z.enum(['true', 'false']).optional(),
  ...PageQuery,
});
export class ListAccountsQueryDto extends createZodDto(ListAccountsQuerySchema) {}

export const ChartAccountResponseSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  category: AccountCategory,
  normalBalance: AccountNormalBalance,
  description: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class ChartAccountResponseDto extends createZodDto(ChartAccountResponseSchema) {}

// ─── Periods ────────────────────────────────────────────────────────────────

const IsoDate = z.string().datetime({ offset: true });
const IsoDateOptional = z.string().datetime({ offset: true }).optional();

export const CreatePeriodSchema = z.object({
  code: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(200),
  startDate: IsoDate,
  endDate: IsoDate,
}).refine((d) => new Date(d.startDate) <= new Date(d.endDate), {
  message: 'startDate must be <= endDate',
  path: ['endDate'],
});
export class CreatePeriodDto extends createZodDto(CreatePeriodSchema) {}

export const ListPeriodsQuerySchema = z.object({
  status: FinancialPeriodStatus.optional(),
  ...PageQuery,
});
export class ListPeriodsQueryDto extends createZodDto(ListPeriodsQuerySchema) {}

export const FinancialPeriodResponseSchema = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  status: FinancialPeriodStatus,
  openedAt: z.date(),
  closedAt: z.date().nullable(),
  closedBy: z.string().nullish(),
  lockedAt: z.date().nullable(),
  lockedBy: z.string().nullish(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class FinancialPeriodResponseDto extends createZodDto(FinancialPeriodResponseSchema) {}

// ─── Journal ────────────────────────────────────────────────────────────────

export const JournalLineInputSchema = z
  .object({
    accountCode: z.string().trim().regex(/^\d+$/, 'Account code must be digits only'),
    debit: MoneyInput.optional(),
    credit: MoneyInput.optional(),
    memo: z.string().trim().max(500).optional(),
  })
  .refine((l) => (l.debit !== undefined) !== (l.credit !== undefined), {
    message: 'Each line must have exactly one of debit or credit',
  });

export const CreateJournalSchema = z.object({
  date: IsoDate,
  description: z.string().trim().max(1000).optional(),
  lines: z.array(JournalLineInputSchema).min(2).max(100),
});
export class CreateJournalDto extends createZodDto(CreateJournalSchema) {}

export const ReverseJournalSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export class ReverseJournalDto extends createZodDto(ReverseJournalSchema) {}

export const ListJournalQuerySchema = z.object({
  accountCode: z.string().trim().optional(),
  status: FinanceTransactionStatus.optional(),
  dateFrom: IsoDateOptional,
  dateTo: IsoDateOptional,
  ...PageQuery,
});
export class ListJournalQueryDto extends createZodDto(ListJournalQuerySchema) {}

export const JournalLineResponseSchema = z.object({
  id: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  debit: z.string(),
  credit: z.string(),
  memo: z.string().nullable(),
});

export const FinanceTransactionResponseSchema = z.object({
  id: z.string(),
  transactionNumber: z.string(),
  periodId: z.string().nullable(),
  date: z.date(),
  description: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  status: FinanceTransactionStatus,
  postedById: z.string().nullable(),
  postedAt: z.date(),
  reversalOfId: z.string().nullable(),
  reversedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lines: z.array(JournalLineResponseSchema),
  totals: z.object({ debit: z.string(), credit: z.string() }),
});
export class FinanceTransactionResponseDto extends createZodDto(
  FinanceTransactionResponseSchema,
) {}

export const ListJournalResponseSchema = z.object({
  items: z.array(FinanceTransactionResponseSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});
export class ListJournalResponseDto extends createZodDto(ListJournalResponseSchema) {}

// ─── Trial balance ──────────────────────────────────────────────────────────

export const TrialBalanceLineSchema = z.object({
  accountCode: z.string(),
  accountName: z.string(),
  category: AccountCategory,
  normalBalance: AccountNormalBalance,
  balance: z.string().nullable(),
});
export const TrialBalanceResponseSchema = z.object({
  items: z.array(TrialBalanceLineSchema),
  totals: z.object({ debit: z.string(), credit: z.string() }),
});
export class TrialBalanceResponseDto extends createZodDto(TrialBalanceResponseSchema) {}