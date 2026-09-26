import { Injectable } from '@nestjs/common';
import { Prisma, type ExpenseStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type {
  SupplierSpendQueryDto,
  WastageReportQueryDto,
} from './dto/analytics.dto';

const APPROVED: ExpenseStatus[] = ['APPROVED'];

/**
 * Procurement & waste analytics (brief Phase 10 §7.11). Aggregates under RLS so
 * every query is tenant-scoped automatically; still bound by where clauses for
 * clarity and index usage.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  /**
   * Wastage report: inventory ledger rows with a WASTAGE operation, grouped by
   * medication with optional branch/date window. Value uses the unit cost
   * recorded on each ledger entry.
   */
  async wastageReport(query: WastageReportQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const where: Prisma.InventoryLedgerEntryWhereInput = {
      organizationId,
      operation: 'WASTAGE',
    };
    if (query.medicationId) where.medicationId = query.medicationId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.from || query.to) {
      where.occurredAt = {};
      if (query.from) where.occurredAt.gte = new Date(query.from);
      if (query.to) where.occurredAt.lte = new Date(query.to);
    }

    const rows = await db.inventoryLedgerEntry.findMany({
      where,
      include: {
        medication: { select: { id: true, name: true, genericName: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 1000,
    });

    const byMedication = new Map<
      string,
      { medicationId: string; name: string | null; genericName: string | null; quantity: number; value: Prisma.Decimal; events: number }
    >();
    for (const row of rows) {
      const key = row.medicationId;
      const wasted = Math.abs(row.quantity);
      const entry = byMedication.get(key) ?? {
        medicationId: key,
        name: row.medication?.name ?? null,
        genericName: row.medication?.genericName ?? null,
        quantity: 0,
        value: new Prisma.Decimal(0),
        events: 0,
      };
      entry.quantity += wasted;
      if (row.unitCost) entry.value = entry.value.add(row.unitCost.mul(wasted));
      entry.events += 1;
      byMedication.set(key, entry);
    }

    return {
      summary: {
        totalEvents: rows.length,
        totalQuantity: [...byMedication.values()].reduce((sum, e) => sum + e.quantity, 0),
        totalValue: [...byMedication.values()]
          .reduce((sum, e) => sum.add(e.value), new Prisma.Decimal(0))
          .toFixed(2),
      },
      items: [...byMedication.values()].map((e) => ({
        medicationId: e.medicationId,
        medication: {
          id: e.medicationId,
          name: e.name,
          genericName: e.genericName,
        },
        quantityWasted: e.quantity,
        estimatedValue: e.value.toFixed(2),
        events: e.events,
      })),
    };
  }

  /** Spend per supplier from APPROVED expenses inside the window (if any). */
  async supplierSpend(query: SupplierSpendQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const where: Prisma.ExpenseWhereInput = {
      organizationId,
      status: { in: APPROVED },
    };
    if (query.from || query.to) {
      where.approvedAt = {};
      if (query.from) where.approvedAt.gte = new Date(query.from);
      if (query.to) where.approvedAt.lte = new Date(query.to);
    }

    const rows = await db.expense.groupBy({
      by: ['supplierId'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });

    if (!rows.length) return { items: [], total: '0.00' };

    const supplierIds = rows.map((r) => r.supplierId).filter((s): s is string => s !== null);
    const suppliers = await db.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(suppliers.map((s) => [s.id, s.name]));

    const items = rows
      .map((r) => ({
        supplierId: r.supplierId,
        supplierName: r.supplierId ? byId.get(r.supplierId) ?? null : null,
        total: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        transactions: r._count._all,
      }))
      .sort((a, b) => new Prisma.Decimal(b.total).sub(new Prisma.Decimal(a.total)).toNumber());
    const total = items.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.total)),
      new Prisma.Decimal(0),
    );
    return { items, total: total.toFixed(2) };
  }

  /**
   * Outstanding balances per supplier: APPROVED (posting cleared the payable)
   * minus PAID expenses.
   */
  async supplierBalances() {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const rows = await db.expense.groupBy({
      by: ['supplierId', 'paymentStatus'],
      where: { status: 'APPROVED' },
      _sum: { amount: true },
      _count: { _all: true },
    });

    if (!rows.length) return { items: [], totalOutstanding: '0.00' };

    const supplierIds = rows.map((r) => r.supplierId).filter((s): s is string => s !== null);
    const suppliers = await db.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(suppliers.map((s) => [s.id, s.name]));

    const bySupplier = new Map<string, { unpaid: Prisma.Decimal; paid: Prisma.Decimal; total: number }>();
    for (const r of rows) {
      if (!r.supplierId) continue;
      const entry = bySupplier.get(r.supplierId) ?? {
        unpaid: new Prisma.Decimal(0),
        paid: new Prisma.Decimal(0),
        total: 0,
      };
      const amount = r._sum.amount ?? new Prisma.Decimal(0);
      if (r.paymentStatus === 'PAID') entry.paid = entry.paid.add(amount);
      else entry.unpaid = entry.unpaid.add(amount);
      entry.total += r._count._all;
      bySupplier.set(r.supplierId, entry);
    }

    const items = [...bySupplier.entries()]
      .map(([supplierId, entry]) => ({
        supplierId,
        supplierName: byId.get(supplierId) ?? null,
        outstanding: entry.unpaid.toFixed(2),
        paid: entry.paid.toFixed(2),
        transactions: entry.total,
      }))
      .sort((a, b) => new Prisma.Decimal(b.outstanding).sub(new Prisma.Decimal(a.outstanding)).toNumber());

    const totalOutstanding = items.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.outstanding)),
      new Prisma.Decimal(0),
    );
    return { items, totalOutstanding: totalOutstanding.toFixed(2) };
  }

  /** Medication purchasing: price/volume per medication across procurements. */
  async procurement(query: SupplierSpendQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const where: Prisma.ExpenseWhereInput = {
      organizationId,
      status: { in: APPROVED },
      category: 'SUPPLIES',
    };
    if (query.from || query.to) {
      where.approvedAt = {};
      if (query.from) where.approvedAt.gte = new Date(query.from);
      if (query.to) where.approvedAt.lte = new Date(query.to);
    }

    const items = await db.expense.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { approvedAt: 'desc' },
      take: 200,
    });

    return {
      items: items.map((e) => ({
        expenseId: e.id,
        expenseNumber: e.expenseNumber,
        supplierId: e.supplierId,
        supplierName: e.supplier?.name ?? null,
        category: e.category,
        amount: e.amount.toFixed(2),
        status: e.status,
        approvedAt: e.approvedAt,
      })),
    };
  }
}