import type {
  AccountCategoryType,
  AccountNormalBalance,
  ChartAccount,
} from '@prisma/client';
import type { TxClient } from '../../../database/tx';
import { newId } from '../../../common/lib/uuidv7';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Chart of accounts (repo Phase 11).
 *
 * A small default chart is lazily seeded per organization on the first ledger
 * write (`ensureChartAccounts`). Organizations may add custom accounts; the
 * seeding is a pure upsert (never overwrites renamed/normalized rows). Codes
 * are the stable keys the auto-posting map references.
 */

export interface DefaultAccountDef {
  code: string;
  name: string;
  category: AccountCategoryType;
  normalBalance: AccountNormalBalance;
  description?: string;
}

export const DEFAULT_CHART_ACCOUNTS: readonly DefaultAccountDef[] = [
  { code: '1000', name: 'Bank & cash', category: 'ASSET', normalBalance: 'DEBIT' },
  { code: '1200', name: 'Accounts receivable', category: 'ASSET', normalBalance: 'DEBIT', description: 'Outstanding patient & payer invoices' },
  { code: '2100', name: 'Accounts payable', category: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '3000', name: 'Retained earnings', category: 'EQUITY', normalBalance: 'CREDIT' },
  { code: '4000', name: 'Service revenue', category: 'REVENUE', normalBalance: 'CREDIT' },
  { code: '5000', name: 'Operating expense', category: 'EXPENSE', normalBalance: 'DEBIT' },
];

export function defaultAccountByCode(code: string): DefaultAccountDef | undefined {
  return DEFAULT_CHART_ACCOUNTS.find((a) => a.code === code);
}

/**
 * Seeding is idempotent: it upserts the default rows by (organizationId, code)
 * without touching user adjustments, then returns code → account so callers
 * can resolve line accounts in one lookup.
 */
export async function ensureChartAccounts(
  db: TxClient,
  organizationId: string,
): Promise<Map<string, ChartAccount>> {
  const byCode = new Map<string, ChartAccount>();
  for (const def of DEFAULT_CHART_ACCOUNTS) {
    const row = await db.chartAccount.upsert({
      where: { organizationId_code: { organizationId, code: def.code } },
      create: {
        id: newId(),
        organizationId,
        code: def.code,
        name: def.name,
        category: def.category,
        normalBalance: def.normalBalance,
        description: def.description ?? null,
      },
      update: {}, // never override user edits
    });
    byCode.set(row.code, row);
  }
  return byCode;
}

/** Throws VALIDATION_ERROR unless the code form looks like an account code. */
export function assertAccountCode(code: string): string {
  const trimmed = code.trim();
  if (!/^\d{3,6}$/.test(trimmed)) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Account code must be 3-6 digits.',
      silent: true,
    });
  }
  return trimmed;
}

export function assertAccountNormalBalance(value: string): void {
  if (value !== 'DEBIT' && value !== 'CREDIT') {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'normalBalance must be DEBIT or CREDIT.',
      silent: true,
    });
  }
}