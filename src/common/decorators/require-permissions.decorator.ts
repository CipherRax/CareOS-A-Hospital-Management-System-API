import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../auth/permissions.catalog';

export const REQUIRED_PERMISSIONS_KEY = 'careos:requiredPermissions';

/**
 * Deny by default: a route without @RequirePermissions or @Public is rejected
 * (see PermissionsGuard and the route-walk CI test). One or more permissions;
 * the guard requires ALL listed permissions of the caller.
 */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
