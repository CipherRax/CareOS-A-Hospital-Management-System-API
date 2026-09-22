import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { isPermission, PERMISSION_LIST } from '../../common/auth/permissions.catalog';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { BREAK_GLASS_MAX_MINUTES } from './dto/break-glass.dto';
import type { BreakGlassGrant, Prisma } from '@prisma/client';

/**
 * Break-glass skeleton (Phase 1): requests are recorded, audited and emitted,
 * but never approved or activated — no PENDING grant can become ACTIVE through
 * any code path (a manual DB write is required, which is audited separately).
 * The hard self-escalation rule lives here: you cannot even *request* access
 * for a permission you already hold.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly txRunner: TxRunner,
  ) {}

  async request(input: {
    resourceType: string;
    resourceId: string;
    permission: string;
    reason: string;
    expiresInMinutes: number;
  }) {
    const organizationId = this.tenantContext.requireOrg();
    const requesterUserId = this.tenantContext.requireUserId();

    if (!isPermission(input.permission)) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Unknown permission: ' + input.permission,
        details: { knownPermissions: PERMISSION_LIST },
        silent: true,
      });
    }

    const held = this.tenantContext.scope.permissions ?? [];
    if (held.includes(input.permission)) {
      throw new AppError({
        code: ErrorCodes.BAD_REQUEST,
        message: 'You already hold this permission; no break-glass needed.',
        silent: true,
      });
    }

    const minutes = Math.min(input.expiresInMinutes, BREAK_GLASS_MAX_MINUTES);

    const grant = await this.txRunner.run(async (ctx: TxContext) => {
      const created = await ctx.db.breakGlassGrant.create({
        data: {
          id: newId(),
          organizationId,
          requesterUserId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          reason: input.reason,
          status: 'PENDING',
          metadata: { permission: input.permission, expiresInMinutes: minutes },
          expiresAt: new Date(Date.now() + minutes * 60_000),
        },
      });

      ctx.emit({
        type: EventTypes.BreakGlassRequested,
        aggregateType: 'breakGlassGrant',
        aggregateId: created.id,
        payload: {
          organizationId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          permission: input.permission,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'break_glass.requested',
          resource: 'breakGlassGrant',
          resourceId: created.id,
          reason: input.reason,
          newState: {
            requesterUserId,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            permission: input.permission,
            status: 'PENDING',
          },
        },
      });

      return created;
    });

    return { grant: this.serialize(grant as never) };
  }

  async mine(): Promise<{ grants: Array<unknown> }> {
    const organizationId = this.tenantContext.requireOrg();
    const requesterUserId = this.tenantContext.requireUserId();
    const grants = await this.prisma.tenantFor(organizationId).breakGlassGrant.findMany({
      where: { requesterUserId },
      orderBy: { grantedAt: 'desc' },
      take: 50,
    });
    return { grants: grants.map((g) => this.serialize(g as never)) };
  }

  async list(params: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PageResult<unknown>> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.BreakGlassGrantWhereInput = params.status
      ? { status: params.status as BreakGlassGrant['status'] }
      : {};

    const [rows, total] = await Promise.all([
      db.breakGlassGrant.findMany({
        where,
        orderBy: { grantedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.breakGlassGrant.count({ where }),
    ]);

    return pageOf(
      rows.map((g) => this.serialize(g as never)),
      total,
      page,
      limit,
    );
  }

  async expire(id: string): Promise<void> {
    const organizationId = this.tenantContext.requireOrg();
    const userId = this.tenantContext.requireUserId();
    const db = this.prisma.tenantFor(organizationId);

    const grant = await db.breakGlassGrant.findFirst({ where: { id } });
    if (!grant) throw AppError.notFound('Grant not found');

    const isOwner = grant.requesterUserId === userId;
    const canManage = (this.tenantContext.scope.permissions ?? []).includes(
      'break_glass.manage',
    );
    if (!isOwner && !canManage) {
      throw new AppError({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'Only the requester or an auditor may expire this grant.',
        silent: true,
      });
    }

    const updated = await db.breakGlassGrant.update({
      where: { id },
      data: {
        status: grant.status === 'PENDING' ? 'EXPIRED' : 'REVOKED',
        revokedAt: new Date(),
        revokedByUserId: userId,
        revokeReason: 'Force-expired by requester/auditor',
      },
    });

    await this.audit.record({
      action: 'break_glass.expired',
      resource: 'breakGlassGrant',
      resourceId: id,
      userId,
      organizationId,
      previousState: { status: grant.status },
      newState: { status: updated.status },
    });
  }

  private serialize(g: {
    id: string;
    resourceType: string;
    resourceId: string;
    reason: string;
    status: string;
    metadata: Prisma.JsonValue;
    grantedAt: Date;
    expiresAt: Date;
  }) {
    const metadata =
      g.metadata && typeof g.metadata === 'object' && !Array.isArray(g.metadata)
        ? (g.metadata as Record<string, unknown>)
        : {};
    return {
      id: g.id,
      resourceType: g.resourceType,
      resourceId: g.resourceId,
      permission: typeof metadata.permission === 'string' ? metadata.permission : '',
      reason: g.reason,
      status: g.status,
      createdAt: g.grantedAt,
      expiresAt: g.expiresAt,
    };
  }
}
