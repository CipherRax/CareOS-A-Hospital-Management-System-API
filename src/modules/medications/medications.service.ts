import { Injectable } from '@nestjs/common';
import type { Medication, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import type {
  CreateMedicationDto,
  ListMedicationsQueryDto,
  UpdateMedicationDto,
} from './dto/medication.dto';

/**
 * Medication & supply catalog (brief Phase 5 §7.2). Identity is per-organization
 * (unique on org + name/generic/strength/form/unit); updates use optimistic
 * locking on `version`. Catalog rows are immutable in identity: an edit never
 * changes which stock batches reference the medication.
 */
@Injectable()
export class MedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateMedicationDto) {
    const organizationId = this.tenantContext.requireOrg();
    const medication = await this.txRunner.run(async (ctx: TxContext) => {
      const id = newId();
      await ctx.db.medication.create({
        data: {
          id,
          organizationId,
          category: input.category,
          name: input.name,
          genericName: input.genericName ?? null,
          strength: input.strength ?? null,
          form: input.form ?? null,
          unit: input.unit,
          sku: input.sku ?? null,
          barcode: input.barcode ?? null,
          isControlled: input.isControlled,
          isActive: input.isActive,
          version: 1,
        },
      });
      return ctx.db.medication.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { medication: serialize(medication) };
  }

  async list(query: ListMedicationsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.MedicationWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.isControlled !== undefined) where.isControlled = query.isControlled;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { genericName: { contains: query.search, mode: 'insensitive' } },
        { sku: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.medication.findMany({
        where,
        orderBy: [{ name: 'asc' }, { genericName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.medication.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const medication = await db.medication.findFirst({ where: { id, organizationId } });
    if (!medication) throw notFound('Medication not found');
    return { medication: serialize(medication) };
  }

  async update(id: string, input: UpdateMedicationDto) {
    const organizationId = this.tenantContext.requireOrg();
    const medication = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.medication.findFirst({ where: { id, organizationId } });
      if (!current) throw notFound('Medication not found');

      if (input.version !== undefined && input.version !== current.version) {
        throw new AppError({
          code: ErrorCodes.VERSION_CONFLICT,
          message: `Record was modified concurrently. Current version: ${current.version}.`,
          silent: true,
        });
      }

      return ctx.db.medication.update({
        where: { id },
        data: {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.genericName !== undefined ? { genericName: input.genericName ?? null } : {}),
          ...(input.strength !== undefined ? { strength: input.strength ?? null } : {}),
          ...(input.form !== undefined ? { form: input.form ?? null } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.sku !== undefined ? { sku: input.sku ?? null } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode ?? null } : {}),
          ...(input.isControlled !== undefined ? { isControlled: input.isControlled } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          version: { increment: 1 },
        },
      });
    });
    return { medication: serialize(medication) };
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serialize(m: Medication) {
  return {
    id: m.id,
    organizationId: m.organizationId,
    category: m.category,
    name: m.name,
    genericName: m.genericName,
    strength: m.strength,
    form: m.form,
    unit: m.unit,
    sku: m.sku,
    barcode: m.barcode,
    isControlled: m.isControlled,
    isActive: m.isActive,
    version: m.version,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}