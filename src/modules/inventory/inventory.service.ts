import { Injectable } from '@nestjs/common';
import { Prisma, type StockCount, type StockTransfer } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { allocateFefo, type FefoBatch } from './domain/fefo';
import { assessStockRisk, avgDailyUsage } from './domain/stock-risk';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import {
  assertPrescriptionAction,
  statusAfterDispense,
} from '../prescriptions/domain/prescription-flow';
import type {
  ReceiveStockDto,
  DispenseDto,
  CreateStockTransferDto,
} from './dto/inventory.dto';
import type { StockTransferStatus } from '@prisma/client';

/**
 * Inventory core (brief Phase 5 §7.4): receiving, FEFO dispensing, branch
 * transfers, stock counts and alerting. Every movement is an append-only ledger
 * entry committed in the same transaction as the batch quantity change. Batch
 * rows are locked inside the interactive transaction so concurrent dispensers
 * can never oversell the last unit.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
    private readonly prescriptions: PrescriptionsService,
  ) {}

  /** Receive stock into a branch: create or top up batches + RECEIVED entries. */
  async receive(input: ReceiveStockDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const batches = await this.txRunner.run(async (ctx: TxContext) => {
      await this.requireBranch(ctx, organizationId, input.branchId);

      const received: Array<{ id: string; batchNumber: string; medicationId: string; quantity: number }> =
        [];
      for (const line of input.lines) {
        await this.requireMedication(ctx, organizationId, line.medicationId);
        const existing = await ctx.db.stockBatch.findFirst({
          where: {
            organizationId,
            branchId: input.branchId,
            medicationId: line.medicationId,
            batchNumber: line.batchNumber,
          },
        });

        if (existing) {
          const updated = await ctx.db.stockBatch.update({
            where: { id: existing.id },
            data: {
              onHand: { increment: line.quantity },
              ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
              ...(line.unitCost !== undefined && line.unitCost !== null
                ? { purchaseCost: line.unitCost }
                : {}),
              status: this.batchStatusAfterReceive(line.expiryDate ?? existing.expiryDate),
            },
          });
          received.push({
            id: updated.id,
            batchNumber: updated.batchNumber,
            medicationId: line.medicationId,
            quantity: line.quantity,
          });
        } else {
          const batchId = newId();
          await ctx.db.stockBatch.create({
            data: {
              id: batchId,
              organizationId,
              branchId: input.branchId,
              medicationId: line.medicationId,
              batchNumber: line.batchNumber,
              expiryDate: line.expiryDate ?? null,
              onHand: line.quantity,
              purchaseCost: line.unitCost ?? null,
              sellingPrice: null,
              status: this.batchStatusAfterReceive(line.expiryDate ?? null),
              receivedAt: new Date(),
            },
          });
          received.push({
            id: batchId,
            batchNumber: line.batchNumber,
            medicationId: line.medicationId,
            quantity: line.quantity,
          });
        }

        await this.writeLedger(ctx, {
          organizationId,
          branchId: input.branchId,
          medicationId: line.medicationId,
          batchId: received[received.length - 1]?.id ?? null,
          operation: 'RECEIVED',
          quantity: line.quantity,
          recordedById: actorId,
          unitCost: line.unitCost ?? null,
        });
      }

      ctx.emit({
        type: EventTypes.StockReceived,
        aggregateType: 'stock_batch',
        aggregateId: received[0]?.id ?? input.branchId,
        payload: { branchId: input.branchId, batches: received },
      });
      return received;
    });

    return { batches };
  }

  /** Dispense a prescription using FEFO (batch rows locked in the tx). */
  async dispense(input: DispenseDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const prescription = await this.prescriptions.requireForDispense(
        ctx,
        organizationId,
        input.prescriptionId,
      );
      if (prescription.branchId !== input.branchId) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Dispensing must happen at the branch where the prescription was issued.',
          silent: true,
        });
      }
      assertPrescriptionAction(prescription, 'dispense');

      // Lock the affected batch rows up front (FOR UPDATE) so two concurrent
      // dispensers can never oversell the last unit: the loser re-reads the
      // committed onHand after the winner commits and fails FEFO allocation.
      await this.lockBatchRows(
        ctx,
        organizationId,
        input.branchId,
        input.lines.map((l) => l.medicationId),
      );

      const itemById = new Map(prescription.items.map((it) => [it.medicationId, it]));
      for (const line of input.lines) {
        const item = itemById.get(line.medicationId);
        if (!item) throw notFound('Medication is not on this prescription');
        const remaining = item.quantity - item.dispensedQuantity;
        if (line.quantity <= 0 || line.quantity > remaining) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: `Cannot dispense ${line.quantity} units (${remaining} remain).`,
            silent: true,
          });
        }
      }

      // Lock + evaluate FEFO per line inside the transaction.
      for (const line of input.lines) {
        const batches = await ctx.db.stockBatch.findMany({
          where: { organizationId, branchId: input.branchId, medicationId: line.medicationId },
        });
        const allocations = allocateFefo(toFefoBatches(batches), line.quantity);
        for (const alloc of allocations) {
          await ctx.db.stockBatch.update({
            where: { id: alloc.batchId },
            data: { onHand: { decrement: alloc.quantity } },
          });
          await this.writeLedger(ctx, {
            organizationId,
            branchId: input.branchId,
            medicationId: line.medicationId,
            batchId: alloc.batchId,
            operation: 'DISPENSED',
            quantity: -alloc.quantity,
            recordedById: actorId,
            referenceType: 'prescription',
            referenceId: input.prescriptionId,
          });
        }
      }

      // Advance dispensed counters per item.
      for (const line of input.lines) {
        await ctx.db.prescriptionItem.updateMany({
          where: { prescriptionId: input.prescriptionId, medicationId: line.medicationId, organizationId },
          data: { dispensedQuantity: { increment: line.quantity } },
        });
      }

      const freshItems = await ctx.db.prescriptionItem.findMany({
        where: { prescriptionId: input.prescriptionId, organizationId },
      });
      const totalRequested = freshItems.reduce((s, it) => s + it.quantity, 0);
      const totalDispensed = freshItems.reduce((s, it) => s + it.dispensedQuantity, 0);
      const next = statusAfterDispense(totalRequested, totalDispensed);

      await ctx.db.prescription.update({
        where: { id: input.prescriptionId },
        data: {
          status: next,
          ...(next === 'DISPENSED' ? { dispensedAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });

      ctx.emit({
        type: EventTypes.PrescriptionDispensed,
        aggregateType: 'prescription',
        aggregateId: input.prescriptionId,
        payload: { prescriptionId: input.prescriptionId, patientId: prescription.patientId, status: next },
      });
      return { prescriptionStatus: next, dispensedLines: input.lines.map((l) => l.medicationId) };
    });

    return result;
  }

  /** Request a branch-to-branch transfer (REQUESTED). */
  async createTransfer(input: CreateStockTransferDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const transfer = await this.txRunner.run(async (ctx: TxContext) => {
      if (input.fromBranchId === input.toBranchId) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Transfer must be between two different branches.',
          silent: true,
        });
      }
      await Promise.all([
        this.requireBranch(ctx, organizationId, input.fromBranchId),
        this.requireBranch(ctx, organizationId, input.toBranchId),
      ]);
      for (const line of input.lines) {
        await this.requireMedication(ctx, organizationId, line.medicationId);
      }

      return ctx.db.stockTransfer.create({
        data: {
          id: newId(),
          organizationId,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          status: 'REQUESTED',
          reason: input.reason ?? null,
          requestedById: actorId,
          items: {
            create: input.lines.map((l) => ({
              id: newId(),
              organizationId,
              medicationId: l.medicationId,
              quantity: l.quantity,
            })),
          },
        },
        include: { items: true },
      });
    });

    return { transfer: serializeTransfer(transfer) };
  }

  /** approve | ship | cancel — administrative moves through the workflow engine. */
  async transferAction(id: string, action: 'approve' | 'ship' | 'cancel') {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const transfer = await this.requireTransfer(ctx, organizationId, id);
      const target = transferActionTarget(transfer.status, action);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'stock_transfer', transfer.status, target);

      const data: Prisma.StockTransferUpdateInput = { status: target as StockTransferStatus };
      if (action === 'approve') {
        data.approvedById = actorId;
        data.approvedAt = new Date();
      } else if (action === 'cancel') {
        data.cancelledById = actorId;
        data.cancelledAt = new Date();
      }
      return ctx.db.stockTransfer.update({ where: { id }, data, include: { items: true } });
    });

    return { transfer: serializeTransfer(result) };
  }

  /**
   * Receive a transfer IN_TRANSIT → RECEIVED. Applies both ledger legs
   * (TRANSFER_OUT −q at source, TRANSFER_IN +q at destination) and resets batch
   * quantities FEFO-allocated on the source side. Destination lands in a
   * received batch pinned to this transfer (batchNumber `TRF-<id>`).
   */
  async receiveTransfer(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const transfer = await this.requireTransfer(ctx, organizationId, id);
      const target = transferActionTarget(transfer.status, 'receive');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'stock_transfer', transfer.status, target);

      // Lock source batches so a concurrent dispense/transfer cannot oversell.
      await this.lockBatchRows(
        ctx,
        organizationId,
        transfer.fromBranchId,
        transfer.items.map((i) => i.medicationId),
      );

      for (const item of transfer.items) {
        // Decrement source branch by FEFO allocation.
        const sourceBatches = await ctx.db.stockBatch.findMany({
          where: { organizationId, branchId: transfer.fromBranchId, medicationId: item.medicationId },
        });
        const allocations = allocateFefo(toFefoBatches(sourceBatches), item.quantity);
        for (const alloc of allocations) {
          await ctx.db.stockBatch.update({
            where: { id: alloc.batchId },
            data: { onHand: { decrement: alloc.quantity } },
          });
          await this.writeLedger(ctx, {
            organizationId,
            branchId: transfer.fromBranchId,
            medicationId: item.medicationId,
            batchId: alloc.batchId,
            operation: 'TRANSFER_OUT',
            quantity: -alloc.quantity,
            recordedById: actorId,
            referenceType: 'stock_transfer',
            referenceId: transfer.id,
          });
        }

        // Increment a destination batch pinned to this transfer.
        const destBatchNumber = `TRF-${transfer.id}`;
        const destBatch = await ctx.db.stockBatch.findFirst({
          where: { organizationId, branchId: transfer.toBranchId, medicationId: item.medicationId, batchNumber: destBatchNumber },
        });
        const destBatchId = destBatch?.id ?? newId();
        if (destBatch) {
          await ctx.db.stockBatch.update({
            where: { id: destBatch.id },
            data: { onHand: { increment: item.quantity } },
          });
        } else {
          await ctx.db.stockBatch.create({
            data: {
              id: destBatchId,
              organizationId,
              branchId: transfer.toBranchId,
              medicationId: item.medicationId,
              batchNumber: destBatchNumber,
              expiryDate: null,
              onHand: item.quantity,
              purchaseCost: null,
              sellingPrice: null,
              status: 'AVAILABLE',
              receivedAt: new Date(),
            },
          });
        }
        await this.writeLedger(ctx, {
          organizationId,
          branchId: transfer.toBranchId,
          medicationId: item.medicationId,
          batchId: destBatchId,
          operation: 'TRANSFER_IN',
          quantity: item.quantity,
          recordedById: actorId,
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
        });
      }

      const updated = await ctx.db.stockTransfer.update({
        where: { id },
        data: { status: 'RECEIVED', receivedById: actorId, receivedAt: new Date() },
        include: { items: true },
      });

      ctx.emit({
        type: EventTypes.StockTransferReceived,
        aggregateType: 'stock_transfer',
        aggregateId: id,
        payload: { transferId: id, fromBranchId: transfer.fromBranchId, toBranchId: transfer.toBranchId },
      });
      return updated;
    });

    return { transfer: serializeTransfer(result) };
  }

  /** Open a stock count with a systemQuantity snapshot for every on-hand batch. */
  async createCount(input: { branchId: string; notes?: string }) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const count = await this.txRunner.run(async (ctx: TxContext) => {
      await this.requireBranch(ctx, organizationId, input.branchId);
      const batches = await ctx.db.stockBatch.findMany({
        where: { organizationId, branchId: input.branchId },
        select: { id: true, medicationId: true, onHand: true },
        orderBy: { medicationId: 'asc' },
      });

      const id = newId();
      await ctx.db.stockCount.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId,
          status: 'OPEN',
          notes: input.notes ?? null,
          countedById: actorId,
          items: {
            create: batches.map((b) => ({
              id: newId(),
              organizationId,
              medicationId: b.medicationId,
              batchId: b.id,
              systemQuantity: b.onHand,
              countedQuantity: b.onHand,
            })),
          },
        },
      });
      return ctx.db.stockCount.findFirstOrThrow({
        where: { id, organizationId },
        include: { items: true },
      });
    });

    return { count: serializeCount(count) };
  }

  /** Record a counted quantity for one batch line while the count is OPEN. */
  async recordCountItem(countId: string, itemId: string, countedQuantity: number) {
    const organizationId = this.tenantContext.requireOrg();
    const item = await this.txRunner.run(async (ctx: TxContext) => {
      const count = await ctx.db.stockCount.findFirst({
        where: { id: countId, organizationId },
        select: { id: true, organizationId: true, status: true },
      });
      if (!count) throw notFound('Stock count not found');
      if (count.status !== 'OPEN') {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `This count is already ${count.status}.`,
          silent: true,
        });
      }
      if (countedQuantity < 0) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'countedQuantity must be non-negative.',
          silent: true,
        });
      }
      const existing = await ctx.db.stockCountItem.findFirst({
        where: { id: itemId, countId: count.id, organizationId },
      });
      if (!existing) throw notFound('Count item not found');
      return ctx.db.stockCountItem.update({
        where: { id: itemId },
        data: { countedQuantity },
      });
    });
    return { item };
  }

  /**
   * Apply an OPEN count: every counted line with a variance generates an
   * ADJUSTMENT ledger entry and resets the batch's on-hand. APPLIED is
   * terminal — each count is a point-in-time reconciliation.
   */
  async applyCount(countId: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const applied = await this.txRunner.run(async (ctx: TxContext) => {
      const count = await ctx.db.stockCount.findFirst({
        where: { id: countId, organizationId },
        include: { items: true },
      });
      if (!count) throw notFound('Stock count not found');
      if (count.status !== 'OPEN') {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `This count is already ${count.status}.`,
          silent: true,
        });
      }

      for (const item of count.items) {
        const variance = item.countedQuantity - item.systemQuantity;
        if (variance === 0 || !item.batchId) continue;
        await ctx.db.stockBatch.update({
          where: { id: item.batchId },
          data: { onHand: item.countedQuantity },
        });
        await this.writeLedger(ctx, {
          organizationId,
          branchId: count.branchId,
          medicationId: item.medicationId,
          batchId: item.batchId,
          operation: 'ADJUSTMENT',
          quantity: variance,
          recordedById: actorId,
          referenceType: 'stock_count',
          referenceId: count.id,
        });
      }

      const appliedRow = await ctx.db.stockCount.update({
        where: { id: count.id },
        data: { status: 'APPLIED', appliedById: actorId, appliedAt: new Date() },
        include: { items: true },
      });

      ctx.emit({
        type: EventTypes.StockAdjusted,
        aggregateType: 'stock_count',
        aggregateId: count.id,
        payload: { countId: count.id, branchId: count.branchId },
      });
      return appliedRow;
    });

    return { count: serializeCount(applied) };
  }

  /** LOW_STOCK / REORDER_RISK / EXPIRY_RISK advisories (brief §7.4 alerts). */
  async alerts(query: { branchId?: string }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const batches = await db.stockBatch.findMany({
      where: { organizationId, ...(query.branchId ? { branchId: query.branchId } : {}) },
      include: { medication: { select: { id: true, name: true, unit: true } } },
    });

    const byMed = new Map<string, { medicationId: string; name: string; unit: string; onHand: number; daysToExpiry: Array<number | null> }>();
    for (const b of batches) {
      const cur = byMed.get(b.medicationId) ?? { medicationId: b.medicationId, name: b.medication.name, unit: b.medication.unit, onHand: 0, daysToExpiry: [] as Array<number | null> };
      cur.onHand += b.onHand;
      cur.daysToExpiry.push(b.expiryDate ? Math.max(0, Math.round((b.expiryDate.getTime() - Date.now()) / 86_400_000)) : null);
      byMed.set(b.medicationId, cur);
    }

    const ledger = await db.inventoryLedgerEntry.findMany({
      where: { organizationId, ...(query.branchId ? { branchId: query.branchId } : {}) },
      select: { medicationId: true, operation: true, quantity: true, occurredAt: true },
    });
    const usageByMed = new Map<string, Array<{ operation: string; quantity: number; occurredAt: Date }>>();
    for (const l of ledger) {
      const list = usageByMed.get(l.medicationId) ?? [];
      list.push(l);
      usageByMed.set(l.medicationId, list);
    }

    const alerts: Array<{ medicationId: string; name: string; label: string; detail: string }> = [];
    for (const entry of byMed.values()) {
      const usage = avgDailyUsage(
        (usageByMed.get(entry.medicationId) ?? []).map((l) => ({
          operation: l.operation as Parameters<typeof avgDailyUsage>[0][number]['operation'],
          quantity: l.quantity,
          occurredAt: l.occurredAt,
        })),
        30,
      );
      const tier = assessStockRisk({
        onHand: entry.onHand,
        usagePerDay: usage,
        targetDays: 7,
        daysToExpiry: entry.daysToExpiry,
      });
      if (tier.label === 'LOW_STOCK') {
        alerts.push({
          medicationId: entry.medicationId,
          name: entry.name,
          label: 'LOW_STOCK',
          detail: tier.daysOfCover === null ? 'Stock at or below target cover with no usage history.' : `~${tier.daysOfCover.toFixed(1)} day(s) of cover.`,
        });
      } else if (tier.label === 'REORDER_RISK') {
        alerts.push({
          medicationId: entry.medicationId,
          name: entry.name,
          label: 'REORDER_RISK',
          detail: `${tier.daysOfCover.toFixed(1)} day(s) of cover — order soon.`,
        });
      } else if (tier.label === 'EXPIRY_RISK') {
        alerts.push({
          medicationId: entry.medicationId,
          name: entry.name,
          label: 'EXPIRY_RISK',
          detail: `Closest expiry in ${tier.closestExpiryDays} day(s).`,
        });
      }
    }
    return { alerts };
  }

  /** Current on-hand per medication/branch reconstructed from the ledger. */
  async onHand(query: { branchId?: string }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const rows = await db.inventoryLedgerEntry.groupBy({
      by: ['medicationId', 'branchId'],
      where: { organizationId, ...(query.branchId ? { branchId: query.branchId } : {}) },
      _sum: { quantity: true },
    });
    const ids = [...new Set(rows.map((r) => r.medicationId))];
    const meds = ids.length
      ? await db.medication.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } })
      : [];
    const medMap = new Map(meds.map((m) => [m.id, m]));
    return {
      onHand: rows.map((r) => ({
        medicationId: r.medicationId,
        name: medMap.get(r.medicationId)?.name ?? null,
        unit: medMap.get(r.medicationId)?.unit ?? null,
        branchId: r.branchId,
        quantity: r._sum.quantity ?? 0,
      })),
    };
  }

  // ---- private helpers ----

  private async writeLedger(
    ctx: TxContext,
    input: {
      organizationId: string;
      branchId: string;
      medicationId: string;
      batchId: string | null;
      operation: 'RECEIVED' | 'DISPENSED' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT';
      quantity: number;
      recordedById: string;
      unitCost?: number | null;
      referenceType?: string;
      referenceId?: string;
    },
  ) {
    await ctx.db.inventoryLedgerEntry.create({
      data: {
        id: newId(),
        organizationId: input.organizationId,
        branchId: input.branchId,
        medicationId: input.medicationId,
        batchId: input.batchId,
        operation: input.operation,
        quantity: input.quantity,
        unitCost: input.unitCost ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        recordedById: input.recordedById,
        occurredAt: new Date(),
      },
    });
  }

  private async requireBranch(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.branch.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) throw notFound('Branch not found');
  }

  /**
   * Row-lock every batch for the given medications at a branch (FOR UPDATE).
   * Runs inside the interactive tx: concurrent dispense/transfer transactions
   * block here until the winner commits, then re-read the committed onHand and
   * fail FEFO allocation instead of overselling the last unit. The raw statement
   * bypasses the tenant extension, so organizationId/branchId are explicit.
   */
  private async lockBatchRows(
    ctx: TxContext,
    organizationId: string,
    branchId: string,
    medicationIds: string[],
  ): Promise<void> {
    if (medicationIds.length === 0) return;
    await ctx.db.$queryRaw`
      SELECT id
      FROM stock_batches
      WHERE "organizationId" = ${organizationId}
        AND "branchId" = ${branchId}
        AND "medicationId" IN (${Prisma.join(medicationIds)})
      FOR UPDATE`;
  }

  private async requireMedication(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.medication.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) throw notFound('Medication not found');
  }

  private async requireTransfer(ctx: TxContext, organizationId: string, id: string) {
    const transfer = await ctx.db.stockTransfer.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!transfer) throw notFound('Transfer not found');
    return transfer;
  }

  private batchStatusAfterReceive(expiryDate: Date | null): 'AVAILABLE' | 'QUARANTINED' | 'EXPIRED' {
    return expiryDate && expiryDate <= new Date() ? 'EXPIRED' : 'AVAILABLE';
  }
}

function transferActionTarget(
  from: string,
  action: 'approve' | 'ship' | 'receive' | 'cancel',
): string {
  const target = {
    approve: from === 'REQUESTED' ? 'APPROVED' : undefined,
    ship: from === 'APPROVED' ? 'IN_TRANSIT' : undefined,
    receive: from === 'IN_TRANSIT' ? 'RECEIVED' : undefined,
    cancel: ['REQUESTED', 'APPROVED', 'IN_TRANSIT'].includes(from) ? 'CANCELLED' : undefined,
  }[action];
  if (!target) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `A ${from} transfer cannot be ${action}ed.`,
      silent: true,
    });
  }
  return target;
}

function toFefoBatches(
  batches: Array<{
    id: string;
    batchNumber: string;
    onHand: number;
    expiryDate: Date | null;
    status: string;
  }>,
): FefoBatch[] {
  return batches.map((b) => ({
    id: b.id,
    batchNumber: b.batchNumber,
    onHand: b.onHand,
    expiryDate: b.expiryDate,
    status: b.status as FefoBatch['status'],
  }));
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serializeTransfer(
  t: StockTransfer & { items: Array<{ id: string; medicationId: string; quantity: number }> },
) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    fromBranchId: t.fromBranchId,
    toBranchId: t.toBranchId,
    status: t.status,
    reason: t.reason,
    requestedById: t.requestedById,
    approvedById: t.approvedById,
    approvedAt: t.approvedAt,
    inTransitAt: t.inTransitAt,
    receivedById: t.receivedById,
    receivedAt: t.receivedAt,
    cancelledById: t.cancelledById,
    cancelledAt: t.cancelledAt,
    cancelReason: t.cancelReason,
    items: t.items.map((i) => ({ id: i.id, medicationId: i.medicationId, quantity: i.quantity })),
  };
}

export function serializeCount(c: StockCount & { items: Array<unknown> }) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    branchId: c.branchId,
    status: c.status,
    notes: c.notes,
    countedById: c.countedById,
    appliedById: c.appliedById,
    appliedAt: c.appliedAt,
    items: c.items,
  };
}