import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import {
  SYNCABLE_RESOURCES,
  isCursorShaped,
  isSyncableResource,
} from './domain/sync-resources';
import type { SyncPageResponseDto, SyncQueryDto } from './dto/sync.dto';

const DEFAULT_LIMIT = 100;

/**
 * Offline-first sync (brief §10).
 *
 * The read path is a keyset scan over `change_log` ordered by the monotonic
 * `seq` column. Rows are filtered two ways:
 *  - by the caller's effective permissions — a row is returned only when the
 *    caller holds the `requiredPermission` stamped on the row, the same
 *    permission set the guards use, so a client can never pull a change it
 *    could not read live;
 *  - by the requested resource types, when supplied.
 *
 * The next cursor is the `seq` of the last row on the page. When nothing
 * changed, the caller's cursor is echoed so a poll loop does not accidentally
 * reset to the beginning of history (which would re-deliver the whole log).
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async pull(query: SyncQueryDto): Promise<SyncPageResponseDto> {
    const organizationId = this.tenantContext.requireOrg();
    const permissions = new Set(this.tenantContext.scope.permissions);

    const resources = this.resolveResources(query.resources, permissions);
    const visiblePermissions = this.visiblePermissions(permissions);
    const limit = query.limit ?? DEFAULT_LIMIT;

    const cursor = query.cursor;
    if (cursor !== undefined && cursor !== '' && !isCursorShaped(cursor)) {
      throw new AppError({
        code: ErrorCodes.INVALID_SYNC_CURSOR,
        message: 'The sync cursor is not a valid change-log cursor.',
      });
    }

    const rows = await this.prisma
      .tenantFor(organizationId)
      .changeLog.findMany({
        where: {
          organizationId,
          // Keyset forward scan: strictly after the last row the client saw.
          ...(cursor ? { seq: { gt: BigInt(cursor) } } : {}),
          ...(resources ? { resourceType: { in: resources } } : {}),
          // Belt and braces: even if a resource were mapped to a permission the
          // caller lacks, the row's own stamp keeps it hidden.
          requiredPermission: { in: visiblePermissions },
        },
        orderBy: { seq: 'asc' },
        take: limit + 1,
      });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      changes: page.map((row) => ({
        id: row.id,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        operation: row.operation,
        version: row.version,
        branchId: row.branchId,
        occurredAt: row.occurredAt.toISOString(),
      })),
      cursor: last ? last.seq.toString() : (cursor ?? null),
      hasMore,
    };
  }

  /**
   * Narrows the resource set. When the caller names resources, an unknown name
   * is a 400 (a typo must not silently return nothing); when a named resource
   * requires a permission the caller lacks, it is dropped rather than erroring
   * — the caller simply gets the subset it may see, matching live reads.
   */
  private resolveResources(
    requested: string[] | undefined,
    permissions: Set<string>,
  ): string[] | undefined {
    const visible = new Set(
      SYNCABLE_RESOURCES.filter((r) => permissions.has(r.permission)).map((r) => r.type),
    );

    if (!requested || requested.length === 0) {
      // No filter: only the resources the caller may see.
      return [...visible];
    }

    for (const name of requested) {
      if (!isSyncableResource(name)) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Unknown sync resource: ${name}`,
        });
      }
    }

    return requested.filter((name) => visible.has(name));
  }

  /** The permissions that unlock at least one syncable resource. */
  private visiblePermissions(permissions: Set<string>): string[] {
    return SYNCABLE_RESOURCES.filter((r) => permissions.has(r.permission)).map(
      (r) => r.permission,
    );
  }
}
