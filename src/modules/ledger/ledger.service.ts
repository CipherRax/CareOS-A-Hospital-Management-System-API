import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { newId } from '../../common/lib/uuidv7';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { EventTypes } from '../../events/catalog';
import { formatBillingNumber, nextBillingSequence } from '../billing/domain/billing-number';
import {
  assertAccountCode,
  assertAccountNormalBalance,
  ensureChartAccounts,
} from './domain/ledger-accounts';
import {
  assertBalancedJournal,
  normalizeJournalLine,
  periodOverlaps,
  resolveJournalPeriod,
  toMoney,
} from './domain/ledger-flow';
import type {
  CreateAccountDto,
  CreateJournalDto,
  CreatePeriodDto,
  ListAccountsQueryDto,
  ListJournalQueryDto,
  ListPeriodsQueryDto,
  UpdateAccountDto,
} from './dto/ledger.dto';

export interface SerializedTransaction {
  id: string;
  transactionNumber: string;
  periodId: string | null;
  date: Date;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  status: string;
  postedById: string | null;
  postedAt: Date;
  reversalOfId: string | null;
  reversedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: Array<{
    id: string;
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
    memo: string | null;
  }>;
  totals: { debit: string; credit: string };
}

/** Money → wire string (ADR-029). */
function money(value: Prisma.Decimal | unknown): string {
  const d =
    value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value));
  return d.toFixed(2);
}

/** Full serialized journal with lines resolved to account codes. */
function serializeTransaction(tx: {
  id: string;
  transactionNumber: string;
  periodId: string | null;
  date: Date;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  status: string;
  postedById: string | null;
  postedAt: Date;
  reversalOfId: string | null;
  reversedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: Array<{
    id: string;
    accountCode: string;
    accountName: string;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    memo: string | null;
  }>;
}): SerializedTransaction {
  const lines = tx.lines.map((l) => ({
    id: l.id,
    accountCode: l.accountCode,
    accountName: l.accountName,
    debit: money(l.debit),
    credit: money(l.credit),
    memo: l.memo,
  }));
  let debit = new Prisma.Decimal(0);
  let credit = new Prisma.Decimal(0);
  for (const l of tx.lines) {
    debit = debit.plus(l.debit);
    credit = credit.plus(l.credit);
  }
  return {
    ...tx,
    lines,
    totals: { debit: money(debit), credit: money(credit) },
  };
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly txRunner: TxRunner,
    private readonly tenantContext: TenantContext,
    private readonly prisma: PrismaService,
  ) {}

  /** Tenant-scoped client for non-transactional reads. */
  private db() {
    return this.prisma.tenant;
  }

  // ─── Chart of accounts ─────────────────────────────────────────────────────

  async listAccounts(query: ListAccountsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      organizationId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.active ? { isActive: query.active === 'true' } : {}),
    };
    const [items, total] = await Promise.all([
      this.db().chartAccount.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db().chartAccount.count({ where }),
    ]);
    return {
      items: items.map((a) => ({ ...a })),
      page,
      limit,
      total,
    };
  }

  async createAccount(input: CreateAccountDto) {
    const organizationId = this.tenantContext.requireOrg();
    const code = assertAccountCode(input.code);
    assertAccountNormalBalance(input.normalBalance);
    return this.txRunner.run(async (ctx) => {
      const duplicate = await ctx.db.chartAccount.findFirst({
        where: { organizationId, code },
      });
      if (duplicate) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: `An account with code ${code} already exists.`,
          silent: true,
        });
      }
      return ctx.db.chartAccount.create({
        data: {
          id: newId(),
          organizationId,
          code,
          name: input.name,
          category: input.category,
          normalBalance: input.normalBalance,
          description: input.description?.trim() || null,
        },
      });
    });
  }

  async getAccount(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const account = await this.db().chartAccount.findFirst({
      where: { id, organizationId },
    });
    if (!account) throw AppError.notFound('Chart account not found');
    return { ...account };
  }

  async updateAccount(id: string, input: UpdateAccountDto) {
    const organizationId = this.tenantContext.requireOrg();
    return this.txRunner.run(async (ctx) => {
      const current = await ctx.db.chartAccount.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw AppError.notFound('Chart account not found');
      if (input.version !== undefined && current.version !== input.version) {
        throw new AppError({
          code: ErrorCodes.OPTIMISTIC_LOCK_CONFLICT,
          message: 'The account changed since you loaded it.',
          silent: true,
        });
      }
      return ctx.db.chartAccount.update({
        where: { id: current.id },
        data: {
          name: input.name?.trim() ?? current.name,
          description: input.description === undefined ? current.description : input.description ?? null,
          isActive: input.isActive ?? current.isActive,
          version: { increment: 1 },
        },
      });
    });
  }

  // ─── Financial periods ─────────────────────────────────────────────────────

  async listPeriods(query: ListPeriodsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db().financialPeriod.findMany({
        where,
        orderBy: { startDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db().financialPeriod.count({ where }),
    ]);
    return { items: items.map((p) => this.serializePeriod(p)), page, limit, total };
  }

  async openPeriod(input: CreatePeriodDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    return this.txRunner.run(async (ctx) => {
      const existing = await ctx.db.financialPeriod.findMany({
        where: { organizationId },
        select: { id: true, code: true, status: true, startDate: true, endDate: true },
      });
      if (existing.find((p) => p.code === input.code)) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: `A period with code '${input.code}' already exists.`,
          silent: true,
        });
      }
      if (periodOverlaps(existing, start, end)) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'The new period overlaps an existing period.',
          silent: true,
        });
      }
      return ctx.db.financialPeriod.create({
        data: {
          id: newId(),
          organizationId,
          code: input.code,
          label: input.label,
          startDate: start,
          endDate: end,
          openedById: actorId,
          openedAt: new Date(),
        },
      });
    });
  }

  async closePeriod(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    return this.txRunner.run(async (ctx) => {
      const current = await ctx.db.financialPeriod.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw AppError.notFound('Financial period not found');
      if (current.status !== 'OPEN') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: `Only an OPEN period can be closed (current: ${current.status}).`,
          silent: true,
        });
      }
      const result = await ctx.db.financialPeriod.updateMany({
        where: { id, organizationId, status: 'OPEN' },
        data: { status: 'CLOSED', closedById: actorId, closedAt: new Date() },
      });
      if (result.count !== 1) {
        throw new AppError({
          code: ErrorCodes.CONCURRENT_MODIFICATION,
          message: 'The period changed while closing.',
          silent: true,
        });
      }
      return ctx.db.financialPeriod.findFirst({ where: { id, organizationId } });
    });
  }

  async lockPeriod(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    return this.txRunner.run(async (ctx) => {
      const current = await ctx.db.financialPeriod.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw AppError.notFound('Financial period not found');
      if (current.status !== 'CLOSED') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: `Only a CLOSED period can be locked (current: ${current.status}).`,
          silent: true,
        });
      }
      const result = await ctx.db.financialPeriod.updateMany({
        where: { id, organizationId, status: 'CLOSED' },
        data: { status: 'LOCKED', lockedById: actorId, lockedAt: new Date() },
      });
      if (result.count !== 1) {
        throw new AppError({
          code: ErrorCodes.CONCURRENT_MODIFICATION,
          message: 'The period changed while locking.',
          silent: true,
        });
      }
      return ctx.db.financialPeriod.findFirst({ where: { id, organizationId } });
    });
  }

  // ─── Journal ───────────────────────────────────────────────────────────────

  async listJournal(query: ListJournalQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.FinanceTransactionWhereInput = { organizationId };
    if (query.status) where.status = query.status;
    if (query.dateFrom || query.dateTo) {
      where.date = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (query.accountCode) {
      where.lines = { some: { account: { code: query.accountCode } } };
    }
    const [txs, total] = await Promise.all([
      this.db().financeTransaction.findMany({
        where,
        include: {
          lines: { include: { account: { select: { code: true, name: true } } } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db().financeTransaction.count({ where }),
    ]);
    return {
      items: txs.map((t) => this.mapRows(t)),
      page,
      limit,
      total,
    };
  }

  async getJournal(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const tx = await this.db().financeTransaction.findFirst({
      where: { id, organizationId },
      include: {
        lines: { include: { account: { select: { code: true, name: true } } } },
      },
    });
    if (!tx) throw AppError.notFound('Journal entry not found');
    return this.mapRows(tx);
  }

  /** Manual journal: business event, validated and balanced in one transaction. */
  async postJournal(input: CreateJournalDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    return this.txRunner.run(async (ctx: TxContext) => {
      const accounts = await ensureChartAccounts(ctx.db, organizationId);
      const accountIds = new Map(
        [...accounts.entries()].map(([code, acc]) => [code, acc.id]),
      );
      const lines = input.lines.map((l) =>
        normalizeJournalLine(
          {
            accountCode: l.accountCode,
            debit: l.debit !== undefined ? new Prisma.Decimal(l.debit) : undefined,
            credit: l.credit !== undefined ? new Prisma.Decimal(l.credit) : undefined,
            memo: l.memo,
          },
          accountIds,
        ),
      );
      const { debit, credit } = assertBalancedJournal(lines);

      const date = new Date(input.date);
      const periods = await ctx.db.financialPeriod.findMany({
        where: { organizationId },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      const period = resolveJournalPeriod(periods, date);

      const seq = await nextBillingSequence(ctx.db, organizationId, 'journal');
      const created = await ctx.db.financeTransaction.create({
        data: {
          id: newId(),
          organizationId,
          transactionNumber: formatBillingNumber('journal', seq),
          date,
          periodId: period?.id ?? null,
          description: input.description?.trim() || null,
          status: 'POSTED',
          postedById: actorId,
          postedAt: new Date(),
          lines: {
            create: lines.map((l) => ({
              id: newId(),
              organizationId,
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              memo: l.memo,
            })),
          },
        },
        include: {
          lines: { include: { account: { select: { code: true, name: true } } } },
        },
      });
      ctx.emit({
        type: EventTypes.JournalPosted,
        aggregateType: 'finance_transaction',
        aggregateId: created.id,
        payload: { journalId: created.id },
      });
      void debit;
      void credit;
      return this.mapRows(created);
    });
  }

  /** Reversal: a new journal, inverse legs, linked to — and immobilizing — the original. */
  async reverseJournal(id: string, reason?: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    return this.txRunner.run(async (ctx: TxContext) => {
      const original = await ctx.db.financeTransaction.findFirst({
        where: { id, organizationId },
        include: { lines: true },
      });
      if (!original) throw AppError.notFound('Journal entry not found');
      if (original.status === 'REVERSED') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'A reversed journal cannot be reversed again.',
          silent: true,
        });
      }
      if (original.referenceType || original.referenceId) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'Auto-posted journals cannot be reversed manually.',
          silent: true,
        });
      }

      const date = new Date();
      const periods = await ctx.db.financialPeriod.findMany({
        where: { organizationId },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      const period = resolveJournalPeriod(periods, date);

      const seq = await nextBillingSequence(ctx.db, organizationId, 'journal');
      const reversal = await ctx.db.financeTransaction.create({
        data: {
          id: newId(),
          organizationId,
          transactionNumber: formatBillingNumber('journal', seq),
          date,
          periodId: period?.id ?? null,
          description: `Reversal of ${original.transactionNumber}${reason ? ` — ${reason}` : ''}`,
          status: 'POSTED',
          reversalOfId: original.id,
          postedById: actorId,
          postedAt: new Date(),
          lines: {
            create: original.lines.map((l) => ({
              id: newId(),
              organizationId,
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              memo: l.memo ? `Reversal: ${l.memo}` : null,
            })),
          },
        },
        include: {
          lines: { include: { account: { select: { code: true, name: true } } } },
        },
      });

      const guard = await ctx.db.financeTransaction.updateMany({
        where: { id: original.id, organizationId, status: 'POSTED' },
        data: { status: 'REVERSED', reversedById: actorId, reversedAt: new Date() },
      });
      if (guard.count !== 1) {
        throw new AppError({
          code: ErrorCodes.CONCURRENT_MODIFICATION,
          message: 'The journal was reversed concurrently.',
          silent: true,
        });
      }
      ctx.emit({
        type: EventTypes.JournalReversed,
        aggregateType: 'finance_transaction',
        aggregateId: original.id,
        payload: { journalId: original.id, reversalId: reversal.id },
      });
      return this.mapRows(reversal);
    });
  }

  // ─── Trial balance ─────────────────────────────────────────────────────────

  async trialBalance() {
    const organizationId = this.tenantContext.requireOrg();
    const rows = await this.db().$queryRaw<Array<TrialBalanceRow>>`
      SELECT a."code", a."name", a."category", a."normalBalance",
             COALESCE(SUM(l."debit"), 0) - COALESCE(SUM(l."credit"), 0) AS "net"
        FROM "finance_transaction_lines" l
        JOIN "finance_transactions" t ON t."id" = l."transactionId" AND t."status" IN ('POSTED', 'REVERSED')
        JOIN "chart_accounts" a ON a."id" = l."accountId"
       WHERE l."organizationId" = ${organizationId}
       GROUP BY a."id", a."code", a."name", a."category", a."normalBalance"
       ORDER BY a."code"
    `;
    const [totalsRow] = await this.db().$queryRaw<Array<{ d: Prisma.Decimal; c: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(l."debit"), 0) AS "d", COALESCE(SUM(l."credit"), 0) AS "c"
        FROM "finance_transaction_lines" l
        JOIN "finance_transactions" t ON t."id" = l."transactionId" AND t."status" IN ('POSTED', 'REVERSED')
       WHERE l."organizationId" = ${organizationId}
    `;
    const items = rows.map((r) => {
      const net = toMoney(r.net);
      const balance =
        r.normalBalance === 'DEBIT' ? net : net.negated();
      const zero = balance.isZero();
      return {
        accountCode: r.code,
        accountName: r.name,
        category: r.category,
        normalBalance: r.normalBalance,
        balance: zero ? null : balance.toFixed(2),
      };
    });
    // Every balanced journal keeps these columns equal (ADR-035).
    const totals = {
      debit: toMoney(totalsRow?.d ?? 0).toFixed(2),
      credit: toMoney(totalsRow?.c ?? 0).toFixed(2),
    };
    return { items, totals };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private serializePeriod(p: {
    id: string;
    code: string;
    label: string;
    startDate: Date;
    endDate: Date;
    status: string;
    openedById: string | null;
    openedAt: Date;
    closedById: string | null;
    closedAt: Date | null;
    lockedById: string | null;
    lockedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: p.id,
      code: p.code,
      label: p.label,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      closedBy: p.closedById ?? undefined,
      lockedAt: p.lockedAt,
      lockedBy: p.lockedById ?? undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private mapRows(tx: {
    id: string;
    transactionNumber: string;
    periodId: string | null;
    date: Date;
    description: string | null;
    referenceType: string | null;
    referenceId: string | null;
    status: string;
    postedById: string | null;
    postedAt: Date;
    reversalOfId: string | null;
    reversedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lines: Array<{
      id: string;
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      memo: string | null;
      account: { code: string; name: string };
    }>;
  }): SerializedTransaction {
    return serializeTransaction({
      ...tx,
      lines: tx.lines.map((l) => ({
        id: l.id,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      })),
    });
  }
}

interface TrialBalanceRow {
  code: string;
  name: string;
  category: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  net: Prisma.Decimal;
}