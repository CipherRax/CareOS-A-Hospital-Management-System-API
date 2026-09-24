import { Injectable } from '@nestjs/common';
import type { Prisma, PurchaseOrder } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import {
  assertPurchaseOrderAction,
  type PurchaseOrderAction,
} from './domain/po-flow';
import type {
  ActionPurchaseOrderDto,
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  ReceivePurchaseOrderDto,
} from './dto/purchase-order.dto';

/**
 * Replenishment (brief Phase 5 §7.3): purchase orders from a supplier, a PO is
 * DRAFT → SUBMITTED → APPROVED → ORDERED → (PARTIALLY_RECEIVED →) RECEIVED →
 * CLOSED. Receiving creates/updates stock batches and posts RECEIVED ledger
 * entries referencing the PO. Every action passes the workflow engine.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(input: CreatePurchaseOrderDto) {
    const organizationId = this.tenantContext.requireOrg();
    const createdById = this.tenantContext.requireUserId();

    const purchaseOrder = await this.txRunner.run(async (ctx: TxContext) => {
      const branch = await ctx.db.branch.findFirst({
        where: { id: input.branchId, organizationId },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch not found');
      const supplier = await ctx.db.supplier.findFirst({
        where: { id: input.supplierId, organizationId },
        select: { id: true },
      });
      if (!supplier) throw notFound('Supplier not found');

      const medicationIds = input.items.map((i) => i.medicationId);
      const meds = await ctx.db.medication.findMany({
        where: { id: { in: medicationIds }, organizationId },
        select: { id: true },
      });
      if (meds.length !== new Set(medicationIds).size) {
        throw notFound('One or more catalog items not found');
      }

      const id = newId();
      const poNumber = await this.nextPoNumber(ctx, organizationId);
      await ctx.db.purchaseOrder.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId,
          supplierId: input.supplierId,
          poNumber,
          status: 'DRAFT',
          expectedAt: input.expectedAt ?? null,
          notes: input.notes ?? null,
          createdById,
          items: {
            create: input.items.map((item) => ({
              id: newId(),
              organizationId,
              medicationId: item.medicationId,
              quantityOrdered: item.quantityOrdered,
              unitCost: item.unitCost ?? null,
            })),
          },
        },
      });
      return this.load(ctx, organizationId, id);
    });

    return { purchaseOrder: serializePo(purchaseOrder) };
  }

  async list(query: ListPurchaseOrdersQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.branchId) where.branchId = query.branchId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      db.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { orderBy: { createdAt: 'asc' } } },
      }),
      db.purchaseOrder.count({ where }),
    ]);
    return pageOf(rows.map(serializePo), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const purchaseOrder = await db.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!purchaseOrder) throw notFound('Purchase order not found');
    return { purchaseOrder: serializePo(purchaseOrder) };
  }

  /** submit | approve | order | close — all pass the workflow engine. */
  async action(id: string, input: ActionPurchaseOrderDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const purchaseOrder = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requirePo(ctx, organizationId, id);
      const target = assertPurchaseOrderAction(current, input.action as PurchaseOrderAction);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'purchase_order', current.status, target);

      const data: Prisma.PurchaseOrderUpdateInput = { status: target };
      if (input.action === 'submit') {
        data.submittedById = actorId;
        data.submittedAt = new Date();
      } else if (input.action === 'approve') {
        data.approvedById = actorId;
        data.approvedAt = new Date();
      } else if (input.action === 'close') {
        data.closedAt = new Date();
      }
      const updated = await ctx.db.purchaseOrder.update({
        where: { id },
        data,
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
      return updated;
    });

    return { purchaseOrder: serializePo(purchaseOrder) };
  }

  /**
   * Receive ordered items: create/top-up the stock batches at the PO's branch,
   * post RECEIVED ledger entries, advance quantityReceived and re-evaluate PO
   * status (PARTIALLY_RECEIVED until every line is fully received).
   */
  async receive(id: string, input: ReceivePurchaseOrderDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const purchaseOrder = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requirePo(ctx, organizationId, id);
      const target = assertPurchaseOrderAction(current, 'receive');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'purchase_order', current.status, target);

      const receivedByItem = new Map(input.lines.map((l) => [l.medicationId, l]));
      for (const item of current.items) {
        const line = receivedByItem.get(item.medicationId);
        if (!line) continue;
        const outstanding = item.quantityOrdered - (item as { quantityReceived: number }).quantityReceived;
        if (line.quantity > outstanding) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: `Receiving ${line.quantity} units of ${item.medicationId} exceeds the outstanding ${outstanding}.`,
            silent: true,
          });
        }

        const existing = await ctx.db.stockBatch.findFirst({
          where: {
            organizationId,
            branchId: current.branchId,
            medicationId: item.medicationId,
            batchNumber: line.batchNumber,
          },
        });
        if (existing) {
          await ctx.db.stockBatch.update({
            where: { id: existing.id },
            data: {
              onHand: { increment: line.quantity },
              ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
              status: line.expiryDate && line.expiryDate <= new Date() ? 'EXPIRED' : 'AVAILABLE',
            },
          });
        } else {
          await ctx.db.stockBatch.create({
            data: {
              id: newId(),
              organizationId,
              branchId: current.branchId,
              medicationId: item.medicationId,
              batchNumber: line.batchNumber,
              expiryDate: line.expiryDate ?? null,
              onHand: line.quantity,
              purchaseCost: item.unitCost ?? null,
              sellingPrice: null,
              status: line.expiryDate && line.expiryDate <= new Date() ? 'EXPIRED' : 'AVAILABLE',
              receivedAt: new Date(),
            },
          });
        }

        await ctx.db.inventoryLedgerEntry.create({
          data: {
            id: newId(),
            organizationId,
            branchId: current.branchId,
            medicationId: item.medicationId,
            operation: 'RECEIVED',
            quantity: line.quantity,
            unitCost: item.unitCost ?? null,
            referenceType: 'purchase_order',
            referenceId: current.id,
            recordedById: actorId,
            occurredAt: new Date(),
          },
        });
        await ctx.db.purchaseOrderItem.update({
          where: { id: item.id },
          data: { quantityReceived: { increment: line.quantity } },
        });
      }

      const freshItems = await ctx.db.purchaseOrderItem.findMany({
        where: { purchaseOrderId: current.id, organizationId },
      });
      const fullyReceived = freshItems.every(
        (i) => i.quantityReceived >= i.quantityOrdered,
      );
      const nextStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      const updated = await ctx.db.purchaseOrder.update({
        where: { id: current.id },
        data: {
          status: nextStatus,
          ...(nextStatus === 'RECEIVED' ? { receivedAt: new Date() } : {}),
          version: { increment: 1 },
        },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });

      ctx.emit({
        type: EventTypes.PurchaseOrderReceived,
        aggregateType: 'purchase_order',
        aggregateId: current.id,
        payload: { purchaseOrderId: current.id, status: nextStatus, branchId: current.branchId },
      });
      return updated;
    });

    return { purchaseOrder: serializePo(purchaseOrder) };
  }

  async requirePo(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!row) throw notFound('Purchase order not found');
    return row;
  }

  async load(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.purchaseOrder.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw notFound('Purchase order not found');
    return row;
  }

  private async nextPoNumber(ctx: TxContext, organizationId: string): Promise<string> {
    const last = await ctx.db.purchaseOrder.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: { poNumber: true },
    });
    const seq = last ? parseInt(last.poNumber.split('-').pop() ?? '0', 10) + 1 : 1;
    return `PO-${String(seq).padStart(6, '0')}`;
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

type PurchaseOrderWithItems = PurchaseOrder & {
  items: Array<{
    id: string;
    medicationId: string;
    quantityOrdered: number;
    quantityReceived: number;
    unitCost: Decimal | null;
  }>;
};

export function serializePo(p: PurchaseOrderWithItems) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    branchId: p.branchId,
    supplierId: p.supplierId,
    poNumber: p.poNumber,
    status: p.status,
    expectedAt: p.expectedAt,
    notes: p.notes,
    createdById: p.createdById,
    submittedById: p.submittedById,
    approvedById: p.approvedById,
    submittedAt: p.submittedAt,
    approvedAt: p.approvedAt,
    receivedAt: p.receivedAt,
    closedAt: p.closedAt,
    version: p.version,
    items: p.items.map((it) => ({
      id: it.id,
      medicationId: it.medicationId,
      quantityOrdered: it.quantityOrdered,
      quantityReceived: it.quantityReceived,
      unitCost: it.unitCost,
    })),
  };
}