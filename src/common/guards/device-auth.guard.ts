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
    const digest = hashSecret(token);
    const results = await db.$transaction([
      db.$executeRaw`SELECT set_config('app.current_org', ${organizationId}, true)`,
      // The overlap window (brief §5.16) means the outgoing token stays valid for
      // ten minutes after a rotation, so a device redeploying in that gap is not
      // stranded. Both digests are checked here; only the digests are stored.
      db.displayDevice.findFirst({
        where: {
          OR: [{ tokenHash: digest }, { previousTokenHash: digest }],
        },
        select: {
          id: true,
          organizationId: true,
          branchId: true,
          departmentIds: true,
          status: true,
          tokenHash: true,
          previousTokenExpiresAt: true,
        },
      }),
    ]);
    const device = results[1] as {
      id: string;
      organizationId: string;
      branchId: string;
      departmentIds: string[];
      status: string;
      tokenHash: string | null;
      previousTokenExpiresAt: Date | null;
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
    // A match on the overlap hash only counts while that window is open. The
    // digest column is cleared when the window closes, but the expiry is checked
    // too so an un-cleaned row cannot extend a token's life.
    if (
      device.tokenHash !== digest &&
      (!device.previousTokenExpiresAt || device.previousTokenExpiresAt.getTime() <= Date.now())
    ) {
      throw new AppError({
        code: ErrorCodes.DEVICE_TOKEN_INVALID,
        message: 'This display-device token has expired. Pair the device again.',
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