import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TenantContext } from '../../database/tenant-context';
import { PrismaService } from '../../database/prisma.service';
import { classifySession, type SessionVerdict } from '../auth/refresh-rotation';
import { permissionUnion } from '../auth/rbac';

/**
 * Validates the active session, re-resolves permissions from the database and
 * enforces tenant status / revocation on every authenticated request. Runs AFTER
 * JwtAuthGuard and BEFORE PermissionsGuard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const scope = this.tenantContext.scope;

    if (!scope.organizationId || !scope.userId) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Authentication required.',
        silent: true,
      });
    }

    // Platform jobs are allowed to bypass session revalidation.
    if (scope.isPlatformJob) return true;

    // Test-principal path (sessionId not set): trust the explicit permissions
    // that the test middleware stamped; the tenant extension still blocks
    // cross-org writes through the scoped client.
    if (!scope.sessionId) return true;

    const session = await this.prisma.tenant.session.findUnique({
      where: { id: scope.sessionId },
      include: {
        user: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    if (!session || !session.user) {
      throw new AppError({
        code: ErrorCodes.SESSION_REVOKED,
        message: 'Session has been revoked.',
        silent: true,
      });
    }

    // Defense in depth: the token's organizationId must match the session's.
    if (session.organizationId !== scope.organizationId) {
      throw new AppError({
        code: ErrorCodes.TENANT_ACCESS_DENIED,
        message: 'Session does not belong to this organization.',
        silent: true,
      });
    }

    const verdict: SessionVerdict = classifySession(session, new Date());

    if (verdict === 'revoked') {
      throw new AppError({
        code: ErrorCodes.SESSION_REVOKED,
        message: 'Session has been revoked.',
        silent: true,
      });
    }

    if (verdict === 'expired') {
      throw new AppError({
        code: ErrorCodes.SESSION_EXPIRED,
        message: 'Session has expired.',
        silent: true,
      });
    }

    const { user } = session;

    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      throw new AppError({
        code: ErrorCodes.ACCOUNT_SUSPENDED,
        message: 'Account is not active.',
        silent: true,
      });
    }

    const roles = session.user.userRoles.map((ur) => ur.role);
    const effectivePermissions = permissionUnion(roles);

    this.tenantContext.setScope({
      roles: roles.map((r) => r.key),
      permissions: effectivePermissions,
    });

    return true;
  }
}
