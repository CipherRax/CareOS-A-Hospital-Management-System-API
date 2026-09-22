import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import {
  assertValidPermissions,
  canGrantRole,
  canManageSystemRole,
  isSystemRole,
} from '../../common/auth/rbac';
import { DEFAULT_ROLE_LIST, SYSTEM_ROLE_KEYS } from '../../common/auth/role-matrix';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import type { Prisma, Role } from '@prisma/client';

function serialize(role: Role) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions,
    createdAt: role.createdAt,
  };
}

/**
 * Role CRUD with the no-privilege-escalation rule on every create/update, and
 * system-role protection (SUPER_ADMIN/OWNER/HOSPITAL_ADMIN).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async list(params: {
    page?: number;
    limit?: number;
    q?: string;
  }): Promise<PageResult<ReturnType<typeof serialize>>> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.RoleWhereInput = params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: 'insensitive' } },
            { key: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      db.role.findMany({
        where,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.role.count({ where }),
    ]);

    return pageOf(rows.map(serialize), total, page, limit);
  }

  async findById(id: string): Promise<{ role: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const role = await this.prisma
      .tenantFor(organizationId)
      .role.findFirst({ where: { id } });
    if (!role) throw AppError.notFound('Role not found');
    return { role: serialize(role) };
  }

  /** Catalog metadata for administrators building custom roles. */
  catalog() {
    return {
      groups: DEFAULT_ROLE_LIST.map((r) => ({
        key: r.key,
        name: r.name,
        permissions: r.permissions,
      })),
      systemRoles: [...SYSTEM_ROLE_KEYS],
      permissionGroups: PERMISSION_GROUPS,
    };
  }

  async create(input: {
    name: string;
    key: string;
    description?: string;
    permissions: string[];
  }): Promise<{ role: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const callerPermissions = this.tenantContext.scope.permissions ?? [];
    const db = this.prisma.tenantFor(organizationId);

    assertValidPermissions(input.permissions);

    if (!canGrantRole(callerPermissions, input.permissions)) {
      throw this.escalationDenied();
    }

    const duplicates = await db.role.findFirst({
      where: { OR: [{ key: input.key }, { name: input.name }] },
      select: { id: true },
    });
    if (duplicates) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'A role with this key or name already exists.',
        silent: true,
      });
    }

    const role = await db.role.create({
      data: {
        id: newId(),
        organizationId,
        name: input.name,
        key: input.key,
        description: input.description ?? null,
        permissions: input.permissions,
        isSystem: false,
      },
    });

    await this.audit.record({
      action: 'roles.created',
      resource: 'role',
      resourceId: role.id,
      newState: { key: role.key, permissions: role.permissions },
    });

    return { role: serialize(role) };
  }

  async update(
    id: string,
    input: { name?: string; description?: string | null; permissions?: string[] },
  ): Promise<{ role: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const callerPermissions = this.tenantContext.scope.permissions ?? [];
    const db = this.prisma.tenantFor(organizationId);

    const role = await db.role.findFirst({ where: { id } });
    if (!role) throw AppError.notFound('Role not found');

    if (isSystemRole(role) && input.permissions) {
      if (!canManageSystemRole(callerPermissions, role)) {
        throw new AppError({
          code: ErrorCodes.PERMISSION_DENIED,
          message: 'Only an administrator with full authority may edit a system role.',
          silent: true,
        });
      }
    }

    if (input.permissions) {
      assertValidPermissions(input.permissions);
      if (!canGrantRole(callerPermissions, input.permissions)) {
        throw this.escalationDenied();
      }
    }

    const nextName = input.name ?? role.name;
    if (input.name && input.name !== role.name) {
      const clash = await db.role.findFirst({
        where: { name: nextName, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'A role with this name already exists.',
          silent: true,
        });
      }
    }

    const updated = await db.role.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        permissions: input.permissions ?? undefined,
      },
    });

    await this.audit.record({
      action: 'roles.updated',
      resource: 'role',
      resourceId: id,
      previousState: {
        permissions: role.permissions,
        name: role.name,
      },
      newState: {
        permissions: updated.permissions,
        name: updated.name,
      },
      metadata: { isSystem: role.isSystem },
    });

    return { role: serialize(updated) };
  }

  async remove(id: string): Promise<void> {
    const organizationId = this.tenantContext.requireOrg();
    const callerPermissions = this.tenantContext.scope.permissions ?? [];
    const db = this.prisma.tenantFor(organizationId);

    const role = await db.role.findFirst({
      where: { id },
      include: { userRoles: { select: { id: true }, take: 1 } },
    });
    if (!role) throw AppError.notFound('Role not found');

    if (isSystemRole(role)) {
      if (!canManageSystemRole(callerPermissions, role)) {
        throw new AppError({
          code: ErrorCodes.PERMISSION_DENIED,
          message: 'System roles cannot be deleted by this account.',
          silent: true,
        });
      }
    }

    if (role.userRoles.length > 0) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'Role is assigned to users; remove the assignments first.',
        silent: true,
      });
    }

    await db.role.delete({ where: { id } });

    await this.audit.record({
      action: 'roles.deleted',
      resource: 'role',
      resourceId: id,
      previousState: { key: role.key, permissions: role.permissions },
    });
  }

  private escalationDenied(): AppError {
    return new AppError({
      code: ErrorCodes.PERMISSION_DENIED,
      message: 'A role cannot hold permissions beyond your own.',
      details: { reason: 'PRIVILEGE_ESCALATION_DENIED' },
      silent: true,
    });
  }
}
