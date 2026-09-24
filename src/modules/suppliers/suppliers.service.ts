import { Injectable } from '@nestjs/common';
import type { Prisma, Supplier } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import type {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';

/**
 * Suppliers used for replenishment (brief Phase 5 §7.3). A supplier identity is
 * unique per organization (name). No money arithmetic happens here; purchase
 * order unit costs are authored on the purchase order lines.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateSupplierDto) {
    const organizationId = this.tenantContext.requireOrg();
    const supplier = await this.txRunner.run(async (ctx: TxContext) => {
      const id = newId();
      await ctx.db.supplier.create({
        data: {
          id,
          organizationId,
          name: input.name,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          taxNumber: input.taxNumber ?? null,
          isActive: input.isActive,
        },
      });
      return ctx.db.supplier.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { supplier: serialize(supplier) };
  }

  async list(query: ListSuppliersQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.SupplierWhereInput = {};
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { contactName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.supplier.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const supplier = await db.supplier.findFirst({ where: { id, organizationId } });
    if (!supplier) throw notFound('Supplier not found');
    return { supplier: serialize(supplier) };
  }

  async update(id: string, input: UpdateSupplierDto) {
    const organizationId = this.tenantContext.requireOrg();
    const supplier = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.supplier.findFirst({ where: { id, organizationId } });
      if (!current) throw notFound('Supplier not found');

      return ctx.db.supplier.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName ?? null } : {}),
          ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
          ...(input.email !== undefined ? { email: input.email ?? null } : {}),
          ...(input.address !== undefined ? { address: input.address ?? null } : {}),
          ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber ?? null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    });
    return { supplier: serialize(supplier) };
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serialize(s: Supplier) {
  return {
    id: s.id,
    organizationId: s.organizationId,
    name: s.name,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    address: s.address,
    taxNumber: s.taxNumber,
    isActive: s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}