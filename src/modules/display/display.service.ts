import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { DisplayDevice, DisplayDeviceStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { RealtimeService } from '../../database/realtime.service';
import { REDIS_CLIENT } from '../../database/redis.tokens';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { startOfBusinessDay } from '../schedules/domain/workweek';
import { ACTIVE_QUEUE_STATUSES } from '../queue/domain/queue-flow';
import { queueSortKey } from '../queue/domain/metrics';
import {
  generateDeviceToken,
  generatePairingCode,
  hashSecret,
  normalizePairingCode,
  PAIRING_CODE_TTL_MS,
} from './domain/pairing';
import type {
  PairDisplayDeviceDto,
  RegisterDisplayDeviceDto,
  UpdateDisplayDeviceDto,
} from './dto/display.dto';

const PAIR_MAX_ATTEMPTS = 8;
const PAIR_WINDOW_SECONDS = 15 * 60;

/**
 * Waiting-room display devices (brief §5.16). Registration issues a one-time
 * pairing code (staff-readable); the device swaps it for a revocable token.
 * The token grants ONLY `queue.display`, scoped to the device's branch +
 * departments, and only dispenses PHI-free queue-board data.
 */
@Injectable()
export class DisplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly realtime: RealtimeService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------------------------------------------------------------------------
  // admin lifecycle
  // ---------------------------------------------------------------------------

  async register(input: RegisterDisplayDeviceDto) {
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const [branch, departments] = await Promise.all([
        ctx.db.branch.findFirst({ where: { id: input.branchId, organizationId }, select: { id: true } }),
        ctx.db.department.findMany({
          where: { id: { in: input.departmentIds }, organizationId },
          select: { id: true },
        }),
      ]);
      if (!branch || departments.length !== input.departmentIds.length) {
        throw new AppError({
          code: ErrorCodes.RESOURCE_NOT_FOUND,
          message: 'Branch or one of the departments was not found.',
          silent: true,
        });
      }

      const pairingCode = generatePairingCode();
      const device = await ctx.db.displayDevice.create({
        data: {
          id: newId(),
          organizationId,
          branchId: input.branchId,
          name: input.name,
          departmentIds: input.departmentIds,
          status: 'PENDING_PAIRING',
          pairingCodeHash: hashSecret(pairingCode),
          pairingExpiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
          createdByUserId: this.tenantContext.scope.userId,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'display.device_registered',
          resource: 'display_device',
          resourceId: device.id,
          newState: { branchId: input.branchId, departments: input.departmentIds },
        },
        select: { id: true },
      });
      return { device, pairingCode };
    });

    return { device: serializeDevice(result.device), pairingCode: result.pairingCode };
  }

  async list(query: { branchId?: string; status?: string; page?: number; limit?: number }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Record<string, unknown> = {};
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status as DisplayDeviceStatus;

    const [rows, total] = await Promise.all([
      db.displayDevice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.displayDevice.count({ where }),
    ]);
    return pageOf(rows.map(serializeDevice), total, page, limit);
  }

  async update(id: string, input: UpdateDisplayDeviceDto) {
    const organizationId = this.tenantContext.requireOrg();

    const device = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.displayDevice.findFirst({ where: { id, organizationId } });
      if (!current) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Display device not found.', silent: true });
      }
      if (input.branchId || input.departmentIds) {
        const branchOk = input.branchId
          ? !!(await ctx.db.branch.findFirst({ where: { id: input.branchId, organizationId } }))
          : true;
        const ids = input.departmentIds ?? current.departmentIds;
        const matched = await ctx.db.department.count({
          where: { id: { in: ids }, organizationId },
        });
        if (!branchOk || matched !== ids.length) {
          throw new AppError({
            code: ErrorCodes.RESOURCE_NOT_FOUND,
            message: 'Branch or one of the departments was not found.',
            silent: true,
          });
        }
      }
      const updated = await ctx.db.displayDevice.update({
        where: { id },
        data: {
          name: input.name ?? current.name,
          branchId: input.branchId ?? current.branchId,
          departmentIds: input.departmentIds ?? current.departmentIds,
        },
      });
      await this.audit(ctx, organizationId, 'display.device_updated', id, { fieldsModified: Object.keys(input) });
      return updated;
    });

    return { device: serializeDevice(device) };
  }

  async revoke(id: string) {
    const organizationId = this.tenantContext.requireOrg();

    const device = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.displayDevice.findFirst({ where: { id, organizationId } });
      if (!current) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Display device not found.', silent: true });
      }
      const updated = await ctx.db.displayDevice.update({
        where: { id },
        data: { status: 'REVOKED', tokenHash: null, pairingCodeHash: null, pairingExpiresAt: null },
      });
      await this.audit(ctx, organizationId, 'display.device_revoked', id, { from: current.status });
      ctx.emit({
        type: EventTypes.DisplayDeviceRevoked,
        aggregateType: 'display_device',
        aggregateId: id,
        payload: { deviceId: id },
      });
      return updated;
    });

    this.publish(organizationId, {
      event: EventTypes.DisplayDeviceRevoked,
      aggregateId: id,
      payload: { deviceId: id },
    });
    return { device: serializeDevice(device) };
  }

  async rotateToken(id: string) {
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.displayDevice.findFirst({ where: { id, organizationId } });
      if (!current) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Display device not found.', silent: true });
      }
      if (current.status !== 'ACTIVE') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'Only an ACTIVE device can rotate its token.',
          silent: true,
        });
      }
      const token = generateDeviceToken(current.organizationId);
      const updated = await ctx.db.displayDevice.update({
        where: { id },
        data: { tokenHash: hashSecret(token), tokenRotatedAt: new Date() },
      });
      await this.audit(ctx, organizationId, 'display.device_token_rotated', id, null);
      ctx.emit({
        type: EventTypes.DisplayDeviceRotated,
        aggregateType: 'display_device',
        aggregateId: id,
        payload: { deviceId: id },
      });
      return { updated, token };
    });

    this.publish(organizationId, {
      event: EventTypes.DisplayDeviceRotated,
      aggregateId: id,
      payload: { deviceId: id },
    });
    return { deviceId: result.updated.id, accessToken: result.token };
  }

  /**
   * Re-pair surface: sends an existing device back into PENDING_PAIRING with a
   * fresh one-time code. The current token is killed immediately (the old
   * board stops working until the new code is exchanged). Pairs with
   * `POST /admin/display-devices/:id/rescan` (brief §5.16).
   */
  async rescan(id: string) {
    const organizationId = this.tenantContext.requireOrg();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.displayDevice.findFirst({ where: { id, organizationId } });
      if (!current) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Display device not found.', silent: true });
      }

      const pairingCode = generatePairingCode();
      const updated = await ctx.db.displayDevice.update({
        where: { id },
        data: {
          status: 'PENDING_PAIRING',
          tokenHash: null,
          tokenRotatedAt: null,
          pairingCodeHash: hashSecret(pairingCode),
          pairingExpiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
        },
      });
      await this.audit(ctx, organizationId, 'display.device_repair_initiated', id, {
        from: current.status,
      });
      ctx.emit({
        type: EventTypes.DisplayDeviceRepairInitiated,
        aggregateType: 'display_device',
        aggregateId: id,
        payload: { deviceId: id },
      });
      return { updated, pairingCode };
    });

    this.publish(organizationId, {
      event: EventTypes.DisplayDeviceRepairInitiated,
      aggregateId: id,
      payload: { deviceId: id },
    });
    return { device: serializeDevice(result.updated), pairingCode: result.pairingCode };
  }

  // ---------------------------------------------------------------------------
  // pairing (public, IP rate-limited)
  // ---------------------------------------------------------------------------

  async pair(input: PairDisplayDeviceDto, ip?: string) {
    if (ip) {
      await this.assertPairAttemptAllowed(ip);
    }

    const code = normalizePairingCode(input.code);

    // Public, org-agnostic discovery: a pairing code embeds no tenant, so it is
    // resolved unscoped first (the anonymous device has no request org). The
    // actual state change then runs in a tenant transaction pinned to the
    // device's organization.
    const found = await this.prisma.unscoped().displayDevice.findFirst({
      where: { status: 'PENDING_PAIRING', pairingCodeHash: hashSecret(code) },
      select: { id: true, organizationId: true },
    });
    if (!found) {
      await this.recordPairAttempt(ip);
      throw new AppError({
        code: ErrorCodes.PAIRING_CODE_INVALID,
        message: 'Unknown pairing code.',
        silent: true,
      });
    }

    const result = await this.txRunner.run(
      async (ctx: TxContext) => {
        const device = await ctx.db.displayDevice.findFirst({ where: { id: found.id } });
        if (!device || device.status !== 'PENDING_PAIRING') {
          throw new AppError({
            code: ErrorCodes.PAIRING_CODE_INVALID,
            message: 'Unknown pairing code.',
            silent: true,
          });
        }
        if (device.pairingExpiresAt && device.pairingExpiresAt.getTime() < Date.now()) {
          throw new AppError({
            code: ErrorCodes.PAIRING_CODE_EXPIRED,
            message: 'This pairing code has expired.',
            silent: true,
          });
        }

        const token = generateDeviceToken(device.organizationId);
        const updated = await ctx.db.displayDevice.update({
          where: { id: device.id },
          data: {
            status: 'ACTIVE',
            name: input.name?.trim() || device.name,
            tokenHash: hashSecret(token),
            pairingCodeHash: null,
            pairingExpiresAt: null,
            tokenRotatedAt: null,
            lastSeenAt: new Date(),
          },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId: device.organizationId,
            action: 'display.device_paired',
            resource: 'display_device',
            resourceId: device.id,
            newState: { branchId: device.branchId },
          },
          select: { id: true },
        });
        ctx.emit({
          type: EventTypes.DisplayDevicePaired,
          aggregateType: 'display_device',
          aggregateId: device.id,
          payload: { deviceId: device.id },
        });
        return { device: updated, token };
      },
      { organizationId: found.organizationId },
    );

    const orgId = result.device.organizationId;
    this.publish(orgId, {
      event: EventTypes.DisplayDevicePaired,
      aggregateId: result.device.id,
      payload: { deviceId: result.device.id },
    });
    if (ip) {
      await this.redis.del(pairAttemptKey(ip)).catch(() => {});
    }
    return { deviceId: result.device.id, accessToken: result.token };
  }

  // ---------------------------------------------------------------------------
  // device-facing views
  // ---------------------------------------------------------------------------

  /** Compact PHI-free waiting-room board for the device's branch/departments. */
  async snapshot() {
    const scope = this.tenantContext.scope.device;
    if (!scope) {
      throw new AppError({ code: ErrorCodes.PERMISSION_DENIED, message: 'Device scope required.', silent: true });
    }
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const now = startOfBusinessDay(new Date());
    const departments = await db.department.findMany({
      where: { id: { in: scope.departmentIds }, organizationId },
      select: { id: true, name: true },
    });

    const entries = await db.queueEntry.findMany({
      where: {
        organizationId,
        branchId: scope.branchId,
        departmentId: { in: scope.departmentIds },
        queueDate: now,
        status: { in: [...ACTIVE_QUEUE_STATUSES] },
      },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        operationalPriority: true,
        enteredAt: true,
        departmentId: true,
      },
    });

    const board = departments.map((dept) => {
      const owned = entries.filter((e) => e.departmentId === dept.id);
      const waiting = owned
        .filter((e) => e.status === 'WAITING')
        .sort((a, b) => queueSortKey(a).localeCompare(queueSortKey(b)));
      return {
        departmentId: dept.id,
        name: dept.name,
        nowServing: owned
          .filter((e) => e.status === 'IN_SERVICE')
          .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime())
          .map(publicEntry),
        called: owned
          .filter((e) => e.status === 'CALLED')
          .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime())
          .map(publicEntry),
        nextUp: waiting.slice(0, 5).map(publicEntry),
        waitingCount: waiting.length,
        updatedAt: new Date().toISOString(),
      };
    });

    await this.touchDevice(scope.deviceId).catch(() => {});
    return { queueDate: now.toISOString(), departments: board };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private async assertPairAttemptAllowed(ip: string): Promise<void> {
    await this.redis;
    const key = pairAttemptKey(ip);
    const count = await this.redis.get(key).catch(() => null);
    if (count && Number(count) >= PAIR_MAX_ATTEMPTS) {
      throw new AppError({
        code: ErrorCodes.PAIRING_ATTEMPTS_EXCEEDED,
        message: 'Too many pairing attempts; try again later.',
        silent: true,
      });
    }
  }

  /** Records a failed attempt; returns the running count (0 when Redis is down). */
  private async recordPairAttempt(ip?: string): Promise<number> {
    if (!ip) return 0;
    const key = pairAttemptKey(ip);
    const count = await this.redis.incr(key).catch(() => 0);
    if (count === 1) {
      await this.redis.expire(key, PAIR_WINDOW_SECONDS).catch(() => {});
    }
    if (count >= PAIR_MAX_ATTEMPTS) {
      throw new AppError({
        code: ErrorCodes.PAIRING_ATTEMPTS_EXCEEDED,
        message: 'Too many pairing attempts; try again later.',
        silent: true,
      });
    }
    return count;
  }

  private async touchDevice(deviceId: string): Promise<unknown> {
    return this.prisma.unscoped().displayDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date() },
      select: { id: true },
    });
  }

  private async audit(
    ctx: TxContext,
    organizationId: string,
    action: string,
    resourceId: string,
    newState: Record<string, unknown> | null,
  ): Promise<void> {
    await ctx.db.auditLog.create({
      data: {
        id: newId(),
        organizationId,
        action,
        resource: 'display_device',
        resourceId,
        newState: newState ?? {},
      },
      select: { id: true },
    });
  }

  private publish(
    organizationId: string,
    event: { event: string; aggregateId: string; payload: Record<string, unknown> },
  ): void {
    this.realtime.publish(organizationId, 'display', { version: 1, ...event });
  }
}

/** IP-wide throttling key; pairing is org-agnostic so the key must be too. */
function pairAttemptKey(ip: string): string {
  return `display:pair:${ip}`;
}

/** Only fields that are safe to show on a public waiting-room board. */
function publicEntry(e: {
  id: string;
  ticketNumber: string;
  status: string;
  operationalPriority: string;
}): Record<string, unknown> {
  return {
    id: e.id,
    ticketNumber: e.ticketNumber,
    status: e.status,
    priority: e.operationalPriority,
  };
}

function serializeDevice(d: DisplayDevice) {
  return {
    id: d.id,
    branchId: d.branchId,
    name: d.name,
    departmentIds: d.departmentIds,
    status: d.status,
    pairingExpiresAt: d.pairingExpiresAt,
    tokenRotatedAt: d.tokenRotatedAt,
    lastSeenAt: d.lastSeenAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}