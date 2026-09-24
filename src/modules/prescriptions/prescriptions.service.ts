import { Injectable } from '@nestjs/common';
import type { Prescription, Prisma } from '@prisma/client';
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
  assertPrescriptionAction,
  prescriptionTargetStatus,
} from './domain/prescription-flow';
import type {
  ActionPrescriptionDto,
  CreatePrescriptionDto,
  ListPrescriptionsQueryDto,
} from './dto/prescription.dto';

/**
 * Prescriptions (brief Phase 5 §7.5). A prescription pins the patient, the
 * issuing provider and the branch where dispensing happens. Lifecycle moves
 * pass the workflow engine; dispensing itself lives in the InventoryService
 * (it mutates stock + ledger and advances the prescription).
 */
@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(input: CreatePrescriptionDto) {
    const organizationId = this.tenantContext.requireOrg();
    const providerId = this.tenantContext.requireUserId();

    const prescription = await this.txRunner.run(async (ctx: TxContext) => {
      const patient = await ctx.db.patient.findFirst({
        where: { id: input.patientId, organizationId },
        select: { id: true },
      });
      if (!patient) throw notFound('Patient not found');

      const branchId = input.branchId ?? (await this.defaultBranch(ctx, organizationId));
      const branch = await ctx.db.branch.findFirst({
        where: { id: branchId, organizationId },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch not found');

      const medicationIds = input.items.map((i) => i.medicationId);
      const meds = await ctx.db.medication.findMany({
        where: { id: { in: medicationIds }, organizationId },
        select: { id: true },
      });
      if (meds.length !== new Set(medicationIds).size) {
        throw notFound('One or more catalog items not found');
      }

      const id = newId();
      await ctx.db.prescription.create({
        data: {
          id,
          organizationId,
          branchId,
          patientId: input.patientId,
          providerId,
          status: 'DRAFT',
          notes: input.notes ?? null,
          items: {
            create: input.items.map((item) => ({
              id: newId(),
              organizationId,
              medicationId: item.medicationId,
              quantity: item.quantity,
              dosage: item.dosage ?? null,
              frequency: item.frequency ?? null,
              durationDays: item.durationDays ?? null,
              instructions: item.instructions ?? null,
            })),
          },
        },
      });

      return this.load(ctx, organizationId, id);
    });

    return { prescription: serializePrescription(prescription) };
  }

  async list(query: ListPrescriptionsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.PrescriptionWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.providerId) where.providerId = query.providerId;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      db.prescription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { orderBy: { createdAt: 'asc' } } },
      }),
      db.prescription.count({ where }),
    ]);
    return pageOf(rows.map(serializePrescription), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const prescription = await db.prescription.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!prescription) throw notFound('Prescription not found');
    return { prescription: serializePrescription(prescription) };
  }

  /** Issue (DRAFT → ISSUED) or cancel — both pass the workflow engine. */
  async action(id: string, input: ActionPrescriptionDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const prescription = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.prescription.findFirst({
        where: { id, organizationId },
        include: { items: true },
      });
      if (!current) throw notFound('Prescription not found');

      assertPrescriptionAction(current, input.action);
      const target = prescriptionTargetStatus(input.action);
      await this.workflows.assertAllowed(
        ctx.db,
        organizationId,
        'prescription',
        current.status,
        target,
      );

      const update =
        input.action === 'issue'
          ? { status: target as 'ISSUED', issuedById: actorId, issuedAt: new Date() }
          : {
              status: target as 'CANCELLED',
              cancelledById: actorId,
              cancelledAt: new Date(),
              cancelReason: input.cancelReason ?? null,
            };

      const updated = await ctx.db.prescription.update({
        where: { id },
        data: { ...update, version: { increment: 1 } },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });

      ctx.emit({
        type:
          input.action === 'issue'
            ? EventTypes.PrescriptionIssued
            : EventTypes.PrescriptionCancelled,
        aggregateType: 'prescription',
        aggregateId: id,
        payload: {
          prescriptionId: id,
          patientId: current.patientId,
          ...(input.action === 'cancel'
            ? { cancelReason: input.cancelReason ?? null }
            : {}),
        },
      });
      return updated;
    });

    return { prescription: serializePrescription(prescription) };
  }

  async requireForDispense(ctx: TxContext, organizationId: string, id: string) {
    const current = await ctx.db.prescription.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });
    if (!current) throw notFound('Prescription not found');
    return current;
  }

  async load(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.prescription.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw notFound('Prescription not found');
    return row;
  }

  private async defaultBranch(ctx: TxContext, organizationId: string): Promise<string> {
    const branch = await ctx.db.branch.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) throw notFound('No branch configured for this organization');
    return branch.id;
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

type PrescriptionWithItems = Prescription & {
  items: Array<{
    id: string;
    medicationId: string;
    quantity: number;
    dispensedQuantity: number;
    dosage: string | null;
    frequency: string | null;
    durationDays: number | null;
    instructions: string | null;
  }>;
};

export function serializePrescription(p: PrescriptionWithItems) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    branchId: p.branchId,
    patientId: p.patientId,
    providerId: p.providerId,
    status: p.status,
    notes: p.notes,
    issuedById: p.issuedById,
    issuedAt: p.issuedAt,
    dispensedAt: p.dispensedAt,
    cancelledById: p.cancelledById,
    cancelledAt: p.cancelledAt,
    cancelReason: p.cancelReason,
    version: p.version,
    items: p.items.map((it) => ({
      id: it.id,
      medicationId: it.medicationId,
      quantity: it.quantity,
      dispensedQuantity: it.dispensedQuantity,
      dosage: it.dosage,
      frequency: it.frequency,
      durationDays: it.durationDays,
      instructions: it.instructions,
    })),
  };
}