import { Injectable } from '@nestjs/common';
import { Prisma, type Expense } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { EventTypes } from '../../events/catalog';
import { assertExpenseAction } from './domain/expense-flow';
import {
  formatOperationsNumber,
  nextOperationsSequence,
} from './domain/operations-number';
import type {
  CreateExpenseDto,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

/**
 * Expenses (brief Phase 10 §7.11). An approval workflow segregates the creator
 * from the approver; an APPROVED expense is a ledger obligation and paying it
 * clears the payable. Ledger posting happens in the outbox consumer (ADR-035):
 * green-lighted events write journals, period locks write exceptions.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateExpenseDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const expense = await this.txRunner.run(async (ctx: TxContext) => {
      await this.requireBranch(ctx, organizationId, input.branchId);
      if (input.departmentId) await this.requireDepartment(ctx, organizationId, input.departmentId);
      if (input.supplierId) {
        const supplier = await ctx.db.supplier.findFirst({
          where: { id: input.supplierId, organizationId },
          select: { id: true },
        });
        if (!supplier) throw notFound('Supplier not found');
      }
      const id = newId();
      const seq = await nextOperationsSequence(ctx.db, organizationId, 'expense');
      await ctx.db.expense.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId,
          departmentId: input.departmentId ?? null,
          supplierId: input.supplierId ?? null,
          expenseNumber: formatOperationsNumber('expense', seq),
          category: input.category,
          description: input.description ?? null,
          reference: input.reference ?? null,
          amount: toMoney(input.amount),
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          createdById: actorId,
        },
      });
      ctx.emit({
        type: EventTypes.ExpenseCreated,
        aggregateType: 'expense',
        aggregateId: id,
        payload: { expenseId: id, amount: toMoney(input.amount).toString() },
      });
      return ctx.db.expense.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { expense: serialize(expense) };
  }

  async list(query: ListExpensesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.ExpenseWhereInput = { organizationId };
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.category) where.category = query.category;
    if (query.branchId) where.branchId = query.branchId;
    if (query.supplierId) where.supplierId = query.supplierId;

    const [rows, total] = await Promise.all([
      db.expense.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.expense.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const expense = await this.requireOut(organizationId, id);
    return { expense: serialize(expense) };
  }

  async update(id: string, input: UpdateExpenseDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const expense = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertExpenseAction(current, 'update', actorId);
      if (input.version !== undefined && Number(input.version) !== current.version) {
        throw versionConflict();
      }
      if (input.branchId) await this.requireBranch(ctx, organizationId, input.branchId);

      return ctx.db.expense.update({
        where: { id: current.id },
        data: {
          ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.reference !== undefined ? { reference: input.reference } : {}),
          ...(input.amount !== undefined ? { amount: toMoney(input.amount) } : {}),
          version: { increment: 1 },
        },
      });
    });
    return { expense: serialize(expense) };
  }

  async submit(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const expense = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      if (current.createdById !== actorId) {
        throw new AppError({
          code: ErrorCodes.SEGREGATION_VIOLATION,
          message: 'Only the expense creator can submit it.',
          silent: true,
        });
      }
      assertExpenseAction(current, 'submit', actorId);
      const updated = await ctx.db.expense.update({
        where: { id: current.id },
        data: {
          status: 'SUBMITTED',
          submittedById: actorId,
          submittedAt: new Date(),
          version: { increment: 1 },
        },
      });
      ctx.emit({
        type: EventTypes.ExpenseSubmitted,
        aggregateType: 'expense',
        aggregateId: current.id,
        payload: { expenseId: current.id },
      });
      return updated;
    });
    return { expense: serialize(expense) };
  }

  async approve(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const expense = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertExpenseAction(current, 'approve', actorId);
      const updated = await ctx.db.expense.update({
        where: { id: current.id },
        data: {
          status: 'APPROVED',
          approvedById: actorId,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });
      ctx.emit({
        type: EventTypes.ExpenseApproved,
        aggregateType: 'expense',
        aggregateId: current.id,
        payload: { expenseId: current.id },
      });
      return updated;
    });
    return { expense: serialize(expense) };
  }

  async reject(id: string, reason: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const expense = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertExpenseAction(current, 'reject', actorId, reason);
      const updated = await ctx.db.expense.update({
        where: { id: current.id },
        data: {
          status: 'REJECTED',
          rejectedById: actorId,
          rejectedAt: new Date(),
          rejectReason: reason.trim(),
          version: { increment: 1 },
        },
      });
      ctx.emit({
        type: EventTypes.ExpenseRejected,
        aggregateType: 'expense',
        aggregateId: current.id,
        payload: { expenseId: current.id },
      });
      return updated;
    });
    return { expense: serialize(expense) };
  }

  async pay(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const expense = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertExpenseAction(current, 'pay', actorId);
      const updated = await ctx.db.expense.update({
        where: { id: current.id },
        data: {
          paymentStatus: 'PAID',
          paidById: actorId,
          paidAt: new Date(),
          version: { increment: 1 },
        },
      });
      ctx.emit({
        type: EventTypes.ExpensePaid,
        aggregateType: 'expense',
        aggregateId: current.id,
        payload: { expenseId: current.id },
      });
      return updated;
    });
    return { expense: serialize(expense) };
  }

  async cancel(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const expense = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertExpenseAction(current, 'cancel', actorId);
      const isCreator = current.createdById === actorId;
      if (current.status === 'SUBMITTED' && !isCreator) {
        throw new AppError({
          code: ErrorCodes.SEGREGATION_VIOLATION,
          message: 'Only the creator may cancel a SUBMITTED expense.',
          silent: true,
        });
      }
      const updated = await ctx.db.expense.update({
        where: { id: current.id },
        data: {
          status: 'CANCELLED',
          cancelledById: actorId,
          cancelledAt: new Date(),
          version: { increment: 1 },
        },
      });
      ctx.emit({
        type: EventTypes.ExpenseCancelled,
        aggregateType: 'expense',
        aggregateId: current.id,
        payload: { expenseId: current.id },
      });
      return updated;
    });
    return { expense: serialize(expense) };
  }

  private async requireIn(ctx: TxContext, organizationId: string, id: string): Promise<Expense> {
    const expense = await ctx.db.expense.findFirst({ where: { id, organizationId } });
    if (!expense) throw notFound('Expense not found');
    return expense;
  }

  private async requireOut(organizationId: string, id: string): Promise<Expense> {
    const expense = await this.prisma.tenantFor(organizationId).expense.findFirst({
      where: { id, organizationId },
    });
    if (!expense) throw notFound('Expense not found');
    return expense;
  }

  private async requireBranch(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.branch.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) throw notFound('Branch not found');
  }

  private async requireDepartment(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.department.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) throw notFound('Department not found');
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function versionConflict(): AppError {
  return new AppError({
    code: ErrorCodes.VERSION_CONFLICT,
    message: 'This expense was modified by someone else. Reload and retry.',
    silent: true,
  });
}

function toMoney(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

function serialize(e: Expense) {
  return {
    id: e.id,
    organizationId: e.organizationId,
    branchId: e.branchId,
    departmentId: e.departmentId,
    supplierId: e.supplierId,
    expenseNumber: e.expenseNumber,
    category: e.category,
    description: e.description,
    reference: e.reference,
    amount: e.amount.toFixed(2),
    status: e.status,
    paymentStatus: e.paymentStatus,
    version: e.version,
    createdById: e.createdById,
    submittedById: e.submittedById,
    approvedById: e.approvedById,
    rejectedById: e.rejectedById,
    rejectReason: e.rejectReason,
    paidById: e.paidById,
    submittedAt: e.submittedAt,
    approvedAt: e.approvedAt,
    rejectedAt: e.rejectedAt,
    paidAt: e.paidAt,
    cancelledById: e.cancelledById,
    cancelledAt: e.cancelledAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}