import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { TxRunner, type TxContext } from '../../database/tx';
import { SessionService } from '../auth/sessions.service';
import { newId } from '../../common/lib/uuidv7';
import { generateHashedToken } from '../../common/security/token';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { canGrantRole } from '../../common/auth/rbac';
import { EventTypes } from '../../events/catalog';
import type { Prisma, User, EmploymentStatus } from '@prisma/client';

const USER_INCLUDE = {
  staffProfile: {
    select: {
      id: true,
      staffNumber: true,
      professionalTitle: true,
      specialization: true,
      employmentStatus: true,
    },
  },
  userRoles: { include: { role: { select: { id: true, key: true, name: true } } } },
} as const;

type UserWithRels = User & {
  staffProfile: unknown;
  userRoles: Array<{ role: { id: string; key: string; name: string } }>;
};

function toUserResponse(u: UserWithRels) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    otherNames: u.otherNames,
    phone: u.phone,
    status: u.status,
    createdAt: u.createdAt,
    roles: u.userRoles.map((ur) => ur.role),
    staff: u.staffProfile,
  };
}

/**
 * User lifecycle & staffing. All role changes pass the no-privilege-escalation
 * rule; status changes that strip access revoke the user's sessions.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly txRunner: TxRunner,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async invite(input: {
    email: string;
    firstName: string;
    lastName: string;
    otherNames?: string;
    phone?: string;
    roleIds?: string[];
    branchIds?: string[];
    departmentIds?: string[];
    staff?: {
      staffNumber: string;
      professionalTitle?: string;
      specialization?: string;
      employmentStatus?: string;
      licenseNumber?: string;
    };
  }): Promise<{ user: ReturnType<typeof toUserResponse>; inviteToken?: string }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const email = input.email.trim().toLowerCase();

    const existing = await db.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'A user with this email already exists in the organization.',
        silent: true,
      });
    }

    const roles = await this.loadRolesChecked(input.roleIds ?? []);
    await this.assertAssignableRoles(roles);

    const branches = await this.loadExistingBranches(input.branchIds ?? []);
    const departments = await this.loadExistingDepartments(input.departmentIds ?? []);

    if (input.staff) {
      const staffExists = await db.staffProfile.findFirst({
        where: { staffNumber: input.staff.staffNumber },
        select: { id: true },
      });
      if (staffExists) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'A staff profile with this staff number already exists.',
          silent: true,
        });
      }
    }

    const { value, digest } = generateHashedToken();
    const inviteExpiresAt = new Date(
      Date.now() + this.env.INVITE_TOKEN_TTL_SECONDS * 1000,
    );

    const inviteToken = this.env.NODE_ENV !== 'production' ? value : undefined;

    const user = await this.txRunner.run(async (ctx: TxContext) => {
      const created = await ctx.db.user.create({
        data: {
          id: newId(),
          organizationId,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          otherNames: input.otherNames ?? null,
          phone: input.phone ?? null,
          status: 'INVITED',
          inviteTokenHash: digest,
          inviteTokenExpiresAt: inviteExpiresAt,
        },
      });

      if (input.staff) {
        await ctx.db.staffProfile.create({
          data: {
            id: newId(),
            organizationId,
            userId: created.id,
            staffNumber: input.staff.staffNumber,
            professionalTitle: input.staff.professionalTitle ?? null,
            specialization: input.staff.specialization ?? null,
            employmentStatus:
              (input.staff.employmentStatus as EmploymentStatus) ?? 'ACTIVE',
            licenseNumber: input.staff.licenseNumber ?? null,
          },
        });
      }

      if (branches.length > 0) {
        await ctx.db.userBranch.createMany({
          data: branches.map((b) => ({
            id: newId(),
            organizationId,
            userId: created.id,
            branchId: b.id,
          })),
        });
      }
      if (departments.length > 0) {
        await ctx.db.userDepartment.createMany({
          data: departments.map((d) => ({
            id: newId(),
            organizationId,
            userId: created.id,
            departmentId: d.id,
          })),
        });
      }
      if (roles.length > 0) {
        await ctx.db.userRole.createMany({
          data: roles.map((r) => ({
            id: newId(),
            organizationId,
            userId: created.id,
            roleId: r.id,
          })),
        });
      }

      if (roles.length > 0) {
        ctx.emit({
          type: EventTypes.StaffInvited,
          aggregateType: 'user',
          aggregateId: created.id,
          payload: { organizationId, roleKeys: roles.map((r) => r.key) },
        });
      }

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'users.invite_created',
          resource: 'user',
          resourceId: created.id,
          reason: `Invited with roles: ${roles.map((r) => r.key).join(', ') || 'none'}`,
          newState: { email, status: 'INVITED' },
        },
      });

      return created;
    });

    const full = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: USER_INCLUDE,
    });

    return { user: toUserResponse(full as UserWithRels), inviteToken };
  }

  async list(params: {
    page?: number;
    limit?: number;
    status?: string;
    q?: string;
  }): Promise<PageResult<ReturnType<typeof toUserResponse>>> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.UserWhereInput = {
      ...(params.status ? { status: params.status as User['status'] } : {}),
      ...(params.q
        ? {
            OR: [
              { email: { contains: params.q, mode: 'insensitive' } },
              { firstName: { contains: params.q, mode: 'insensitive' } },
              { lastName: { contains: params.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    return pageOf((rows as UserWithRels[]).map(toUserResponse), total, page, limit);
  }

  async findById(id: string): Promise<{ user: ReturnType<typeof toUserResponse> }> {
    const organizationId = this.tenantContext.requireOrg();
    const user = await this.prisma
      .tenantFor(organizationId)
      .user.findFirst({ where: { id }, include: USER_INCLUDE });

    if (!user) {
      throw AppError.notFound('User not found');
    }
    return { user: toUserResponse(user as UserWithRels) };
  }

  async update(
    id: string,
    input: {
      firstName?: string;
      lastName?: string;
      otherNames?: string | null;
      phone?: string | null;
      status?: string;
    },
  ): Promise<{ user: ReturnType<typeof toUserResponse> }> {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.scope.userId;
    const db = this.prisma.tenantFor(organizationId);

    if (id === actorId && input.status) {
      throw new AppError({
        code: ErrorCodes.BAD_REQUEST,
        message: 'Manage your own account status through the account settings.',
        silent: true,
      });
    }

    const user = await db.user.findFirst({ where: { id }, include: USER_INCLUDE });
    if (!user) throw AppError.notFound('User not found');

    const nextStatus = (input.status ?? user.status) as User['status'];

    let revokedSessions = 0;
    if (user.status !== nextStatus) {
      if (nextStatus === 'SUSPENDED' || nextStatus === 'DEACTIVATED') {
        revokedSessions = await this.sessions.revokeUserSessions(organizationId, id);
      }
      if (nextStatus === 'ACTIVE') {
        await db.user.update({
          where: { id },
          data: { lockedUntil: null, loginFailureCount: 0 },
        });
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
        otherNames: input.otherNames === undefined ? undefined : input.otherNames,
        phone: input.phone === undefined ? undefined : input.phone,
        status: nextStatus,
      },
      include: USER_INCLUDE,
    });

    await this.audit.record({
      action: 'users.updated',
      resource: 'user',
      resourceId: id,
      reason:
        user.status !== nextStatus ? `status ${user.status} → ${nextStatus}` : undefined,
      previousState: {
        status: user.status,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      newState: { status: updated.status },
      metadata: { revokedSessions },
    });

    if (nextStatus === 'SUSPENDED' && user.status !== 'SUSPENDED') {
      await this.emitOutsideTx(EventTypes.UserSuspended, id, {
        organizationId,
        reason: 'status changed by administrator',
      });
    }
    if (nextStatus === 'DEACTIVATED' && user.status !== 'DEACTIVATED') {
      await this.emitOutsideTx(EventTypes.UserDeactivated, id, {
        organizationId,
      });
    }

    return { user: toUserResponse(updated as UserWithRels) };
  }

  async setRoles(
    id: string,
    roleIds: string[],
  ): Promise<{ user: ReturnType<typeof toUserResponse> }> {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.scope.userId;
    const db = this.prisma.tenantFor(organizationId);

    if (id === actorId) {
      throw new AppError({
        code: ErrorCodes.BAD_REQUEST,
        message: 'You cannot change your own roles through this endpoint.',
        silent: true,
      });
    }

    const user = await db.user.findFirst({ where: { id } });
    if (!user) throw AppError.notFound('User not found');

    const roles = await this.loadRolesChecked(roleIds);
    await this.assertAssignableRoles(roles);

    const tx = this.txRunner;
    await tx.run(async (ctx: TxContext) => {
      await ctx.db.userRole.deleteMany({ where: { userId: id } });
      if (roles.length > 0) {
        await ctx.db.userRole.createMany({
          data: roles.map((r) => ({
            id: newId(),
            organizationId,
            userId: id,
            roleId: r.id,
          })),
        });
      }
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'users.roles_assigned',
          resource: 'user',
          resourceId: id,
          reason: `Roles replaced with: ${roles.map((r) => r.key).join(', ') || 'none'}`,
          newState: { roleKeys: roles.map((r) => r.key) },
        },
      });
    });

    const updated = await db.user.findFirst({
      where: { id },
      include: USER_INCLUDE,
    });
    if (!updated) throw AppError.notFound('User not found');

    return { user: toUserResponse(updated as UserWithRels) };
  }

  async revokeSessions(id: string): Promise<{ revoked: number }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const user = await db.user.findFirst({ where: { id } });
    if (!user) throw AppError.notFound('User not found');

    const revokedCount = await this.sessions.revokeUserSessions(organizationId, id);
    await this.audit.record({
      action: 'users.sessions_revoked',
      resource: 'user',
      resourceId: id,
      metadata: { revoked: revokedCount },
    });
    return { revoked: revokedCount };
  }

  async deactivate(id: string): Promise<void> {
    await this.update(id, { status: 'DEACTIVATED' });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async loadRolesChecked(roleIds: string[]) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    if (roleIds.length === 0) return [];

    const roles = await db.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, key: true, name: true, permissions: true },
    });
    if (roles.length !== roleIds.length) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more roles do not exist in this organization.',
        silent: true,
      });
    }
    return roles;
  }

  private async assertAssignableRoles(
    roles: Array<{ id: string; key: string; name: string; permissions: string[] }>,
  ): Promise<void> {
    const callerPermissions = this.tenantContext.scope.permissions ?? [];
    const denied = roles.filter(
      (role) => !canGrantRole(callerPermissions, role.permissions),
    );
    if (denied.length > 0) {
      throw new AppError({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'Cannot assign a role with permissions beyond your own.',
        details: {
          reason: 'PRIVILEGE_ESCALATION_DENIED',
          roles: denied.map((r) => r.key),
        },
        silent: true,
      });
    }
  }

  private async loadExistingBranches(branchIds: string[]) {
    const organizationId = this.tenantContext.requireOrg();
    if (branchIds.length === 0) return [];
    const db = this.prisma.tenantFor(organizationId);
    const found = await db.branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true },
    });
    if (found.length !== branchIds.length) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more branches do not exist in this organization.',
        silent: true,
      });
    }
    return found;
  }

  private async loadExistingDepartments(departmentIds: string[]) {
    const organizationId = this.tenantContext.requireOrg();
    if (departmentIds.length === 0) return [];
    const db = this.prisma.tenantFor(organizationId);
    const found = await db.department.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true },
    });
    if (found.length !== departmentIds.length) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more departments do not exist in this organization.',
        silent: true,
      });
    }
    return found;
  }

  /** Post-tx outbox emission (best-effort): status events are independent of the row commit. */
  private async emitOutsideTx(
    type: string,
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.tenantFor(payload.organizationId as string).outboxEvent.create({
        data: {
          id: newId(),
          organizationId: payload.organizationId as string,
          type,
          version: 1,
          aggregateType: 'user',
          aggregateId: userId,
          occurredAt: new Date(),
          actorId: this.tenantContext.scope.userId,
          payload: payload as Prisma.InputJsonObject,
          status: 'PENDING',
        },
      });
    } catch {
      // Audited already; a failed post-commit event must not roll back the change.
    }
  }
}
