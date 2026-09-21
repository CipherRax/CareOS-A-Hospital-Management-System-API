import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { newId } from '../common/lib/uuidv7';
import { TenantContext } from './tenant-context';
import { PrismaService } from './prisma.service';

export interface AuditInput {
  action: string;
  resource: string;
  resourceId?: string;
  branchId?: string;
  userId?: string;
  reason?: string;
  previousState?: unknown;
  newState?: unknown;
  metadata?: Record<string, unknown>;
  /** For platform (unscoped) jobs writing into a specific org. */
  organizationId?: string;
}

/**
 * Append-only audit trail. Rows are created via the tenant-scoped client (org
 * injected from context) or, for platform jobs, with an explicit organizationId
 * and an AuditLog written through the unscoped path. There is deliberately no
 * update/delete path in code; the DB trigger blocks them regardless.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async record(input: AuditInput): Promise<void> {
    const scope = this.tenantContext.scope;
    const organizationId = input.organizationId ?? scope.organizationId;

    if (!organizationId) {
      this.logger.warn('Audit skipped: no tenant context');
      return;
    }

    const data: Prisma.AuditLogUncheckedCreateInput = {
      id: newId(),
      organizationId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      branchId: input.branchId,
      userId: input.userId ?? scope.userId,
      reason: input.reason,
      previousState: (input.previousState as Prisma.InputJsonObject) ?? Prisma.JsonNull,
      newState: (input.newState as Prisma.InputJsonObject) ?? Prisma.JsonNull,
      metadata: (input.metadata as Prisma.InputJsonObject) ?? Prisma.JsonNull,
    };

    try {
      if (input.organizationId) {
        // Platform path: explicit org on the unscoped client.
        await this.prisma.unscoped().auditLog.create({ data });
      } else {
        // Tenant path: the extension re-injects the same organizationId (a no-op)
        // while guaranteeing the write can never escape the active tenant.
        await this.prisma.tenant.auditLog.create({ data });
      }
    } catch (err) {
      // Never fail the business operation because audit failed; surface loudly.
      this.logger.error(
        'Audit write failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
