import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Inject } from '@nestjs/common';
import type { Env } from '../config/config.module';
import { ENV } from '../config/config.module';
import { TenantAccessDeniedError, TenantRequiredError } from '../common/errors/app-error';
import { TenantContext } from './tenant-context';

/**
 * Tenant-owned models. The extension injects organizationId into every
 * create/where for these models and throws when the tenant context is missing.
 * Everything else (lookup/reference tables shared across a deployment) is not
 * intercepted.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'Organization',
  'OutboxEvent',
  'ProcessedEvent',
  'AuditLog',
  'IdempotencyRecord',
  'Counter',
  // Identity & access (Phase 1). Keep in sync with prisma/schema.prisma.
  'Branch',
  'Department',
  'User',
  'StaffProfile',
  'UserBranch',
  'UserDepartment',
  'Session',
  'RefreshToken',
  'Role',
  'UserRole',
  'MfaCredential',
  'MfaRecoveryCode',
  'BreakGlassGrant',
  // Object storage (Phase 2).
  'Document',
]);

type Op = string;

/** Rewrites the Prisma operation args so the current tenant is always applied. */
function injectTenant(op: Op, args: unknown, organizationId: string): unknown {
  const a = (args ?? {}) as Record<string, unknown>;
  const where = (a.where ?? {}) as Record<string, unknown>;

  if (op === 'create') {
    return {
      ...a,
      data: { ...((a.data ?? {}) as Record<string, unknown>), organizationId },
    };
  }
  if (op === 'createMany') {
    const data = Array.isArray(a.data)
      ? (a.data as Record<string, unknown>[]).map((d) => ({ ...d, organizationId }))
      : { ...((a.data ?? {}) as Record<string, unknown>), organizationId };
    return { ...a, data };
  }
  if (op === 'upsert') {
    const create = {
      ...((a.create ?? {}) as Record<string, unknown>),
      organizationId,
    };
    const data = { ...((a.data ?? {}) as Record<string, unknown>) };
    delete data.organizationId;
    return { ...a, create, data };
  }
  if (op === 'findUnique' || op === 'findUniqueOrThrow') {
    return { ...a, where: { ...where, organizationId } };
  }
  const needsWhere = [
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'count',
    'aggregate',
    'groupBy',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
  ];
  if (needsWhere.includes(op)) {
    return { ...a, where: { ...where, organizationId } };
  }
  return args;
}

function buildTenantExtension(getOrgId: () => string | null) {
  return {
    name: 'tenant-scope',
    query: {
      async $allOperations({
        model,
        operation,
        args,
        query,
      }: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Prisma.PrismaPromise<unknown>;
      }) {
        const isTenantModel = TENANT_MODELS.has(model ?? '');
        if (!isTenantModel) return query(args);

        const organizationId = getOrgId();
        if (organizationId === null) {
          throw new TenantRequiredError();
        }

        if (model === 'Organization') {
          if (operation.startsWith('create') || operation === 'upsert') {
            throw new TenantAccessDeniedError();
          }
          // The root entity is identity-scoped; reads and mutations are pinned to
          // the caller's org (a tenant can only ever touch its own row).
          return query({
            ...((args as Record<string, unknown>) ?? {}),
            where: { id: organizationId },
          });
        }

        return query(injectTenant(operation, args, organizationId));
      },
    },
  };
}

export function createTenantClient(client: PrismaClient, getOrgId: () => string | null) {
  return client.$extends(buildTenantExtension(getOrgId));
}

export type TenantClient = ReturnType<typeof createTenantClient>;

/**
 * Owns the raw PrismaClient and the tenant-extended client. Module services
 * depend on this service and use `this.prisma.tenant` for tenant-owned data.
 * `unscoped()` returns the raw client and must only be used by audited
 * platform/worker code — never by normal request flows.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  private readonly base: PrismaClient;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly tenantContext: TenantContext,
  ) {
    const logConfig: Prisma.LogDefinition[] =
      env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : [];

    this.base = new PrismaClient({
      datasources: { db: { url: env.DATABASE_URL } },
      log: logConfig,
    });

    this.tenant = createTenantClient(this.base, () =>
      this.tenantContext.hasOrg() ? this.tenantContext.requireOrg() : null,
    );
  }

  /** Tenant-scoped client. Default for application code. */
  readonly tenant: TenantClient;

  /**
   * Tenant-scoped client bound to an explicit organization, independent of the
   * request context. Used by TxRunner so platform jobs and transactions share
   * the same injection rules. Interactive transactions run on this client so
   * the extension's query hooks apply to every operation inside the tx.
   */
  tenantFor(organizationId: string): TenantClient {
    return createTenantClient(this.base, () => organizationId);
  }

  /**
   * Explicit, audited escape hatch for platform/worker jobs. Callers that use
   * it MUST write an AuditLog entry documenting why.
   */
  unscoped(): PrismaClient {
    return this.base;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.base.$connect();
    } catch (err) {
      this.logger.error(
        'Failed to connect to database',
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}

export { Prisma };
