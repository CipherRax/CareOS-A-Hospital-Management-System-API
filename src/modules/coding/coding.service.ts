import { Injectable } from '@nestjs/common';
import type { CodeConcept, CodingSystem, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { validateConceptRows } from './domain/coding-import';
import type {
  CreateCodingSystemDto,
  ImportCodingConceptsDto,
  ListConceptsQueryDto,
  ListCodingSystemsQueryDto,
} from './dto/coding.dto';

/**
 * Org-owned coding reference data (brief Phase 4 §6.6 §12). Systems are created
 * per tenant; concepts are imported idempotently (upsert on the tenant-system-
 * code unique key). Codes are never fabricated — diagnoses only reference
 * concepts that exist here or use explicit free text.
 */
@Injectable()
export class CodingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateCodingSystemDto) {
    const organizationId = this.tenantContext.requireOrg();

    const system = await this.txRunner.run(async (ctx: TxContext) => {
      const existing = await ctx.db.codingSystem.findFirst({
        where: { organizationId, key: input.key },
        select: { id: true },
      });
      if (existing) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'A coding system with this key already exists.',
          silent: true,
        });
      }
      return ctx.db.codingSystem.create({
        data: {
          id: newId(),
          organizationId,
          key: input.key,
          name: input.name,
          version: input.version ?? null,
          kind: input.kind,
          source: input.source ?? null,
          isActive: true,
        },
      });
    });

    return { codingSystem: serializeSystem(system) };
  }

  async list(query: ListCodingSystemsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);
    const where: Prisma.CodingSystemWhereInput = { organizationId, isActive: true };
    const [rows, total] = await Promise.all([
      db.codingSystem.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
      db.codingSystem.count({ where }),
    ]);
    return pageOf(rows.map(serializeSystem), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const system = await db.codingSystem.findFirst({ where: { id, organizationId } });
    if (!system) throw notFound('Coding system not found');
    return { codingSystem: serializeSystem(system) };
  }

  /**
   * Idempotent concept import. Validates the payload, then upserts each row on
   * (organizationId, systemId, code). Returns inserted/updated counts.
   */
  async import(id: string, input: ImportCodingConceptsDto) {
    const organizationId = this.tenantContext.requireOrg();
    const rows = validateConceptRows(input.concepts.map((c) => ({
      code: c.code,
      display: c.display,
      description: c.description,
      metadata: c.metadata,
    })));

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const system = await ctx.db.codingSystem.findFirst({ where: { id, organizationId } });
      if (!system) throw notFound('Coding system not found');
      if (!system.isActive) {
        throw new AppError({ code: ErrorCodes.UNPROCESSABLE_ENTITY, message: 'Coding system is inactive.', silent: true });
      }

      let inserted = 0;
      // Upsert doesn't report create/update; diff against pre-existing rows.
      const total = rows.length;
      const { existingBefore } = await this.countExisting(ctx, organizationId, id, rows.map((r) => r.code));
      for (const row of rows) {
        await ctx.db.codeConcept.upsert({
          where: { organizationId_systemId_code: { organizationId, systemId: id, code: row.code } },
          create: {
            id: newId(),
            organizationId,
            systemId: id,
            code: row.code,
            display: row.display,
            description: row.description ?? null,
            metadata: row.metadata as Prisma.InputJsonObject | undefined,
          },
          update: {
            display: row.display,
            description: row.description ?? null,
            metadata: row.metadata as Prisma.InputJsonValue | undefined,
            isActive: true,
          },
        });
      }
      inserted = total - existingBefore;

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'coding.imported',
          resource: 'coding_system',
          resourceId: id,
          newState: { inserted, total },
        },
      });
      ctx.emit({
        type: EventTypes.CodingSystemImported,
        aggregateType: 'coding_system',
        aggregateId: id,
        payload: { codingSystemId: id, inserted, total },
      });
      return { inserted, updated: total - inserted, total };
    });

    return { importResult: result };
  }

  async listConcepts(systemId: string, query: ListConceptsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.CodeConceptWhereInput = { organizationId, systemId };
    if (query.active !== undefined) where.isActive = query.active;
    if (query.query) {
      where.OR = [
        { code: { contains: query.query, mode: 'insensitive' } },
        { display: { contains: query.query, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.codeConcept.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { system: { select: { key: true } } },
      }),
      db.codeConcept.count({ where }),
    ]);
    return pageOf(rows.map(serializeConcept), total, page, limit);
  }

  private async countExisting(
    ctx: TxContext,
    organizationId: string,
    systemId: string,
    codes: string[],
  ): Promise<{ existingBefore: number }> {
    const found = await ctx.db.codeConcept.findMany({
      where: { organizationId, systemId, code: { in: codes } },
      select: { code: true },
    });
    return { existingBefore: found.length };
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serializeSystem(s: CodingSystem) {
  return {
    id: s.id,
    organizationId: s.organizationId,
    key: s.key,
    name: s.name,
    version: s.version,
    kind: s.kind,
    source: s.source,
    isActive: s.isActive,
  };
}

export function serializeConcept(c: CodeConcept & { system: { key: string } }) {
  return {
    id: c.id,
    systemId: c.systemId,
    code: c.code,
    display: c.display,
    description: c.description,
    codeSystemKey: c.system.key,
    isActive: c.isActive,
  };
}