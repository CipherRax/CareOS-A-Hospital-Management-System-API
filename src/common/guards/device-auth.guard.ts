import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';
import { TenantContext } from '../../database/tenant-context';
import { PrismaService } from '../../database/prisma.service';
import { hashSecret } from '../security/device-secret';

function bearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Authenticates an unattended waiting-room display by its device token.
 *
 * Attached locally (@UseGuards) to the PUBLIC device endpoints. Tokens carry
 * their organization as a prefix (`<orgId>.<random>`); only the digest is
 * stored. The lookup runs in a transaction that pins the RLS tenant GUC, so it
 * is safe whether the app connects as the table owner (dev) or as `careos_app`
 * (RLS enforced). Only ACTIVE devices pass, and the scope granted is strictly
 * `queue.display` for the device's own branch + departments.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown>;
    }>();
    const token = bearerToken(request.headers?.['authorization']);

    if (!token) {
      throw new AppError({
        code: ErrorCodes.DEVICE_TOKEN_INVALID,
        message: 'A valid display-device token is required.',
        silent: true,
      });
    }

    const dot = token.indexOf('.');
    if (dot <= 0) {
      throw new AppError({
        code: ErrorCodes.DEVICE_TOKEN_INVALID,
        message: 'Malformed display-device token.',
        silent: true,
      });
    }
    const organizationId = token.slice(0, dot);

    const db = this.prisma.tenantFor(organizationId);
    const results = await db.$transaction([
      db.$executeRaw`SELECT set_config('app.current_org', ${organizationId}, true)`,
      db.displayDevice.findFirst({
        where: { tokenHash: hashSecret(token) },
        select: {
          id: true,
          organizationId: true,
          branchId: true,
          departmentIds: true,
          status: true,
        },
      }),
    ]);
    const device = results[1] as {
      id: string;
      organizationId: string;
      branchId: string;
      departmentIds: string[];
      status: string;
    } | null;

    if (!device) {
      throw new AppError({
        code: ErrorCodes.DEVICE_TOKEN_INVALID,
        message: 'Unknown or invalid display device.',
        silent: true,
      });
    }
    if (device.status !== 'ACTIVE') {
      throw new AppError({
        code: ErrorCodes.DEVICE_REVOKED,
        message: 'Display device is not active.',
        silent: true,
      });
    }

    this.tenantContext.setScope({
      organizationId: device.organizationId,
      userId: null,
      sessionId: null,
      roles: [],
      permissions: ['queue.display'],
      patientId: null,
      device: {
        deviceId: device.id,
        branchId: device.branchId,
        departmentIds: device.departmentIds,
      },
    });

    return true;
  }
}