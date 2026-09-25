import { Injectable } from '@nestjs/common';
import type { Incident, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { assertIncidentTransition } from './domain/quality-flow';
import type {
  CreateIncidentDto,
  ListIncidentsQueryDto,
  UpdateIncidentStatusDto,
} from './dto/quality.dto';

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

/**
 * Incidents (brief Phase 10). Internal safety/operations incidents are reported
 * by staff; every status change emits IncidentStatusChanged and stamps the
 * resolver/closer.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async create(input: CreateIncidentDto) {
    const organizationId = this.tenantContext.requireOrg();
    const reportedById = this.tenantContext.requireUserId();

    const incident = await this.txRunner.run(async (ctx: TxContext) => {
      const id = newId();
      await ctx.db.incident.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId,
          category: input.category,
          severity: input.severity,
          description: input.description,
          reportedById,
          status: 'OPEN',
        },
      });
      return ctx.db.incident.findFirstOrThrow({ where: { id, organizationId } });
    });
    return { incident: serialize(incident) };
  }

  async list(query: ListIncidentsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.IncidentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.category) where.category = query.category;

    const [rows, total] = await Promise.all([
      db.incident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.incident.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const incident = await db.incident.findFirst({ where: { id, organizationId } });
    if (!incident) throw notFound('Incident not found');
    return { incident: serialize(incident) };
  }

  async updateStatus(id: string, input: UpdateIncidentStatusDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const incident = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.incident.findFirst({
        where: { id, organizationId },
      });
      if (!current) throw notFound('Incident not found');

      const next = input.status;
      assertIncidentTransition(current.status, next);

      const data: Prisma.IncidentUncheckedUpdateInput = { status: next };
      if (input.actionsTaken !== undefined) data.actionsTaken = input.actionsTaken ?? null;
      if (input.resolution !== undefined) data.resolution = input.resolution ?? null;
      if (next === 'RESOLVED') {
        data.resolvedById = actorId;
        data.resolvedAt = new Date();
      }
      if (next === 'CLOSED') {
        data.closedById = actorId;
        data.closedAt = new Date();
      }

      const updated = await ctx.db.incident.update({ where: { id }, data });
      ctx.emit({
        type: EventTypes.IncidentStatusChanged,
        aggregateType: 'incident',
        aggregateId: id,
        payload: { incidentId: id, status: next },
      });
      return updated;
    });
    return { incident: serialize(incident) };
  }
}

export function serialize(i: Incident) {
  return {
    id: i.id,
    organizationId: i.organizationId,
    branchId: i.branchId,
    category: i.category,
    severity: i.severity,
    description: i.description,
    reportedById: i.reportedById,
    status: i.status,
    actionsTaken: i.actionsTaken,
    resolution: i.resolution,
    resolvedById: i.resolvedById,
    resolvedAt: i.resolvedAt,
    closedById: i.closedById,
    closedAt: i.closedAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}