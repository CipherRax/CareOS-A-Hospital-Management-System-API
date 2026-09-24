import { Injectable } from '@nestjs/common';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import {
  WORKFLOW_VALID_STATUSES,
  SYSTEM_TRANSITIONS,
  addableEdges,
  assertWorkflowTransition,
  effectiveEdges,
  isValidWorkflowEntityType,
  type WorkflowEdge,
  type WorkflowEntityType,
} from './domain/workflow-core';

/**
 * Org-scoped workflow customization. Only reads and additive transitions are
 * exposed — the safe core (SYSTEM_TRANSITIONS) lives in code and can never be
 * edited away. See ADR on workflow safety bounds.
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  async get(entityType: string) {
    const organizationId = this.tenantContext.requireOrg();
    const type = this.requireEntityType(entityType);

    const db = this.prisma.tenantFor(organizationId);
    const workflow = await this.ensureWorkflow(db, organizationId, type);
    const custom = await this.customEdges(db, organizationId, workflow.id);

    return {
      entityType: type,
      isActive: workflow.isActive,
      systemEdges: SYSTEM_TRANSITIONS[type],
      customEdges: custom,
      edges: effectiveEdges(type, custom),
      addable: addableEdges(type, custom),
    };
  }

  async addTransition(entityType: string, input: { fromStatus: string; toStatus: string; label?: string }) {
    const organizationId = this.tenantContext.requireOrg();
    const type = this.requireEntityType(entityType);

    if (!WORKFLOW_VALID_STATUSES[type].includes(input.fromStatus) ||
        !WORKFLOW_VALID_STATUSES[type].includes(input.toStatus)) {
      throw new AppError({
        code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
        message: `${input.fromStatus}→${input.toStatus} is not a valid ${type} status pair.`,
        silent: true,
      });
    }

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const workflow = await this.ensureWorkflow(ctx.db, organizationId, type);
      const custom = await this.customEdges(ctx.db, organizationId, workflow.id);
      if (effectiveEdges(type, custom).some((e) => e.fromStatus === input.fromStatus && e.toStatus === input.toStatus)) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'That transition already exists.',
          silent: true,
        });
      }

      const created = await ctx.db.workflowTransition.create({
        data: {
          id: newId(),
          organizationId,
          workflowId: workflow.id,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          label: input.label ?? null,
        },
      });
      ctx.emit({
        type: EventTypes.WorkflowTransitionAdded,
        aggregateType: 'workflow',
        aggregateId: workflow.id,
        payload: { workflowId: workflow.id, fromStatus: input.fromStatus, toStatus: input.toStatus },
      });
      return created;
    });

    return {
      id: result.id,
      workflowId: result.workflowId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      label: result.label,
    };
  }

  /**
   * Central guard used by every transition service. Reads custom edges and
   * throws INVALID_WORKFLOW_TRANSITION unless the move is allowed.
   */
  async assertAllowed(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    entityType: WorkflowEntityType,
    fromStatus: string,
    toStatus: string,
  ): Promise<void> {
    const workflow = await this.ensureWorkflow(db, organizationId, entityType);
    const custom = await this.customEdges(db, organizationId, workflow.id);
    assertWorkflowTransition(entityType, fromStatus, toStatus, custom);
  }

  private async ensureWorkflow(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    entityType: WorkflowEntityType,
  ) {
    const existing = await db.workflow.findUnique({
      where: { organizationId_entityType: { organizationId, entityType } },
    });
    if (existing) return existing;
    return db.workflow.create({
      data: {
        id: newId(),
        organizationId,
        entityType,
        name: `${entityType} workflow`,
        description: 'System workflow with additive org customizations.',
      },
    });
  }

  private async customEdges(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    workflowId: string,
  ): Promise<WorkflowEdge[]> {
    const rows = await db.workflowTransition.findMany({
      where: { organizationId, workflowId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ fromStatus: r.fromStatus, toStatus: r.toStatus }));
  }

  private requireEntityType(value: string): WorkflowEntityType {
    if (!isValidWorkflowEntityType(value)) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown workflow entity type '${value}'.`,
        silent: true,
      });
    }
    return value;
  }
}