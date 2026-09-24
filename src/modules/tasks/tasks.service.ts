import { Injectable } from '@nestjs/common';
import type { Prisma, Task } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { assertTaskAction, type TaskAction } from './domain/task-flow';
import type {
  CreateTaskDto,
  ListTasksQueryDto,
  TransitionTaskDto,
  UpdateTaskDto,
} from './dto/task.dto';

/**
 * Assignable tasks for a patient / hospital flow (brief Phase 4 §6.6).
 * Metadata (title, priority, assignment, due) is editable while OPEN; status
 * moves go through the workflow engine and emit TaskStatusChanged.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(input: CreateTaskDto) {
    const organizationId = this.tenantContext.requireOrg();
    const createdById = this.tenantContext.requireUserId();

    const task = await this.txRunner.run(async (ctx: TxContext) => {
      if (input.patientId) {
        const patient = await ctx.db.patient.findFirst({
          where: { id: input.patientId, organizationId },
          select: { id: true },
        });
        if (!patient) throw notFound('Patient not found');
      }
      if (input.encounterId) {
        const encounter = await ctx.db.encounter.findFirst({
          where: { id: input.encounterId, organizationId },
          select: { id: true },
        });
        if (!encounter) throw notFound('Encounter not found');
      }
      if (input.assignedUserId) {
        const assignee = await ctx.db.user.findFirst({
          where: { id: input.assignedUserId, organizationId },
          select: { id: true },
        });
        if (!assignee) throw notFound('Assignee not found');
      }

      const created = await ctx.db.task.create({
        data: {
          id: newId(),
          organizationId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          status: 'OPEN',
          assignedUserId: input.assignedUserId ?? null,
          patientId: input.patientId ?? null,
          encounterId: input.encounterId ?? null,
          dueAt: input.dueAt ?? null,
          createdById,
        },
      });

      ctx.emit({
        type: EventTypes.TaskCreated,
        aggregateType: 'task',
        aggregateId: created.id,
        payload: {
          taskId: created.id,
          patientId: input.patientId ?? null,
          assignedUserId: input.assignedUserId ?? null,
        },
      });
      return created;
    });

    return { task: serialize(task) };
  }

  async list(query: ListTasksQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.TaskWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.encounterId) where.encounterId = query.encounterId;
    if (query.assignedUserId) where.assignedUserId = query.assignedUserId;
    if (query.priority) where.priority = query.priority;
    if (query.status) where.status = query.status;
    if (query.dueFrom || query.dueTo) {
      where.dueAt = {
        ...(query.dueFrom ? { gte: query.dueFrom } : {}),
        ...(query.dueTo ? { lte: query.dueTo } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      db.task.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      db.task.count({ where }),
    ]);
    return pageOf(rows.map(serialize), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const task = await db.task.findFirst({ where: { id, organizationId } });
    if (!task) throw notFound('Task not found');
    return { task: serialize(task) };
  }

  async update(id: string, input: UpdateTaskDto) {
    const organizationId = this.tenantContext.requireOrg();

    const task = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireTask(ctx, organizationId, id);
      if (current.status !== 'OPEN') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'Task metadata can only be edited while the task is OPEN.',
          silent: true,
        });
      }
      return ctx.db.task.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
        },
      });
    });

    return { task: serialize(task) };
  }

  async transition(id: string, input: TransitionTaskDto) {
    const organizationId = this.tenantContext.requireOrg();

    const task = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireTask(ctx, organizationId, id);
      const target = assertTaskAction(current.status, input.action as TaskAction);
      const from = current.status;

      await this.workflows.assertAllowed(ctx.db, organizationId, 'task', from, target);

      ctx.emit({
        type: EventTypes.TaskStatusChanged,
        aggregateType: 'task',
        aggregateId: id,
        payload: {
          taskId: id,
          patientId: current.patientId ?? null,
          from,
          to: target,
          cancelReason: input.action === 'cancel' ? input.cancelReason : undefined,
        },
      });

      return ctx.db.task.update({
        where: { id },
        data: {
          status: target,
          ...(target === 'DONE' ? { completedAt: new Date() } : {}),
          ...(target === 'CANCELLED'
            ? { cancelledAt: new Date(), cancelReason: input.cancelReason ?? null }
            : {}),
        },
      });
    });

    return { task: serialize(task) };
  }

  private async requireTask(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.task.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Task not found');
    return row;
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

export function serialize(t: Task) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    assignedUserId: t.assignedUserId,
    patientId: t.patientId,
    encounterId: t.encounterId,
    dueAt: t.dueAt,
    createdById: t.createdById,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    cancelReason: t.cancelReason,
  };
}