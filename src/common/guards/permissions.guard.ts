import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { TenantContext } from '../../database/tenant-context';

/** Sentinel used by ApiEndpoint when a route forgot @RequirePermissions or @Public. */
const DENY_BY_DEFAULT = '__deny_by_default__';

/**
 * First line of defense (Phase 0 skeleton; the JWT guard lands in Phase 1).
 * Deny by default: a route needing permissions but lacking explicit metadata,
 * or a caller without all required permissions, is rejected.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const targetClass = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [handler, targetClass],
    );
    if (isPublic) return true;

    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
        handler,
        targetClass,
      ]) ?? [];

    if (required.length === 0 || required.includes(DENY_BY_DEFAULT)) {
      this.logger.warn(
        `Route is missing authorization metadata: ${context.getClass().name}.${handler.name}`,
      );
      throw new AppError({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'Forbidden',
        details: { reason: 'ROUTE_NOT_ENFORCED' },
        silent: true,
      });
    }

    const scope = this.tenantContext.scope;
    const principalPermissions = new Set(scope.permissions ?? []);

    const missing = required.filter((p) => !principalPermissions.has(p));
    if (missing.length > 0) {
      throw new AppError({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'Forbidden',
        details: { missing },
        silent: true,
      });
    }

    return true;
  }
}
