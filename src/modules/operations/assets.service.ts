import { Injectable } from '@nestjs/common';
import { Prisma, type Asset } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { EventTypes } from '../../events/catalog';
import { assertAssetRetirable, assertAssetTag } from './domain/asset-flow';
import type { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './dto/asset.dto';

/**
 * Physical assets (brief Phase 10 §7.11): equipment, computers, vehicles, beds
 * and machines with a branch/department location and lifecycle status.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateAssetDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const asset = await this.txRunner.run(async (ctx: TxContext) => {
      if (input.branchId) await this.requireBranch(ctx, organizationId, input.branchId);
      if (input.departmentId) await this.requireDepartment(ctx, organizationId, input.departmentId);
      const assetTag = assertAssetTag(input.assetTag);
      const existing = await ctx.db.asset.findFirst({ where: { organizationId, assetTag }, select: { id: true } });
      if (existing) throw tagConflict(assetTag);
      const id = newId();
      await ctx.db.asset.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId ?? null,
          departmentId: input.departmentId ?? null,
          assetTag,
          category: input.category,
          name: input.name,
          serialNumber: input.serialNumber ?? null,
          location: input.location ?? null,
          status: 'ACTIVE',
          purchaseDate: input.purchaseDate ?? null,
          purchaseCost: input.purchaseCost !== undefined ? toMoney(input.purchaseCost) : null,
          notes: input.notes ?? null,
          createdById: actorId,
        },
      });
      ctx.emit({
        type: EventTypes.AssetCreated,
        aggregateType: 'asset',
        aggregateId: id,
        payload: { assetId: id, assetTag },
      });
      return ctx.db.asset.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { asset: serialize(asset) };
  }

  async list(query: ListAssetsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.AssetWhereInput = { organizationId };
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.branchId) where.branchId = query.branchId;
    if (query.search) {
      where.OR = [
        { assetTag: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        { location: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.asset.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const asset = await this.requireOut(organizationId, id);
    return { asset: serialize(asset) };
  }

  async update(id: string, input: UpdateAssetDto) {
    const organizationId = this.tenantContext.requireOrg();
    const asset = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      if (input.version !== undefined && Number(input.version) !== current.version) {
        throw versionConflict();
      }
      if (input.status === 'RETIRED' || input.status === 'DISPOSED') {
        throw new AppError({
          code: ErrorCodes.ASSET_STATE_CONFLICT,
          message: 'Use the retire endpoint for lifecycle changes; status edits are for maintenance flags.',
          silent: true,
        });
      }
      // Only ACTIVE/MAINTENANCE assets can be edited into either state.
      if (input.branchId) await this.requireBranch(ctx, organizationId, input.branchId);

      return ctx.db.asset.update({
        where: { id: current.id },
        data: {
          ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.purchaseDate !== undefined ? { purchaseDate: input.purchaseDate } : {}),
          ...(input.purchaseCost !== undefined
            ? { purchaseCost: input.purchaseCost === null ? null : toMoney(input.purchaseCost) }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          version: { increment: 1 },
        },
      });
    });
    return { asset: serialize(asset) };
  }

  /** Retire an asset (or dispose). One-way lifecycle change. */
  async retire(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const asset = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireIn(ctx, organizationId, id);
      assertAssetRetirable(current);
      const updated = await ctx.db.asset.update({
        where: { id: current.id },
        data: {
          status: 'RETIRED',
          retiredById: actorId,
          retiredAt: new Date(),
          version: { increment: 1 },
        },
      });
      ctx.emit({
        type: EventTypes.AssetRetired,
        aggregateType: 'asset',
        aggregateId: current.id,
        payload: { assetId: current.id },
      });
      return updated;
    });
    return { asset: serialize(asset) };
  }

  private async requireIn(ctx: TxContext, organizationId: string, id: string): Promise<Asset> {
    const asset = await ctx.db.asset.findFirst({ where: { id, organizationId } });
    if (!asset) throw notFound('Asset not found');
    return asset;
  }

  private async requireOut(organizationId: string, id: string): Promise<Asset> {
    const asset = await this.prisma.tenantFor(organizationId).asset.findFirst({
      where: { id, organizationId },
    });
    if (!asset) throw notFound('Asset not found');
    return asset;
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

function tagConflict(assetTag: string): AppError {
  return new AppError({
    code: ErrorCodes.CONFLICT,
    message: `An asset with tag '${assetTag}' already exists in this organization.`,
    silent: true,
  });
}

function versionConflict(): AppError {
  return new AppError({
    code: ErrorCodes.VERSION_CONFLICT,
    message: 'This asset was modified by someone else. Reload and retry.',
    silent: true,
  });
}

function toMoney(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

function serialize(a: Asset) {
  return {
    id: a.id,
    organizationId: a.organizationId,
    branchId: a.branchId,
    departmentId: a.departmentId,
    assetTag: a.assetTag,
    category: a.category,
    name: a.name,
    serialNumber: a.serialNumber,
    location: a.location,
    status: a.status,
    purchaseDate: a.purchaseDate,
    purchaseCost: a.purchaseCost === null ? null : a.purchaseCost.toFixed(2),
    notes: a.notes,
    version: a.version,
    retiredById: a.retiredById,
    retiredAt: a.retiredAt,
    createdById: a.createdById,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}