import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import type { AdminQueueName } from './domain/admin-queues';
import type {
  FailedJobResponseDto,
  ListJobsQueryDto,
  ListJobsResponseDto,
} from './dto/admin-jobs.dto';

/** The token the admin module's queues are provided under. */
export const ADMIN_JOB_QUEUES_TOKEN = Symbol('ADMIN_JOB_QUEUES');

/** The most failed jobs a single listing returns. */
const MAX_LISTED = 200;

/** The shape of the job list we read out of Redis. */
interface FailedQueueJob {
  id?: string;
  name: string;
  data: unknown;
  attemptsMade: number;
  failedReason?: string;
  timestamp: number;
}

/**
 * Admin inspection of failed background work (brief §5.9).
 *
 * Two surfaces produce failures in this system: the transactional outbox (an
 * event whose dispatch was never acknowledged, retried `MAX_OUTBOX_ATTEMPTS`
 * times and marked `DEAD`) and BullMQ (a queue job that threw). Both are
 * listed here, and both can be requeued or discarded.
 *
 * What a listing shows is deliberately narrow: a name, the reason it failed,
 * how many attempts it took, when it failed, and a *reference* to what it was
 * working on. The payload itself is not returned. A failed job's payload is
 * ids-only by construction, but the ids it carries are still patient
 * identifiers, and an admin screen is not where they should accumulate.
 */
@Injectable()
export class AdminJobsService {
  private readonly logger = new Logger(AdminJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    @Inject(ADMIN_JOB_QUEUES_TOKEN)
    private readonly queues: ReadonlyMap<AdminQueueName, Queue>,
  ) {}

  async list(query: ListJobsQueryDto): Promise<ListJobsResponseDto> {
    const organizationId = this.tenantContext.requireOrg();

    const limit = Math.min(query.limit ?? MAX_LISTED, MAX_LISTED);
    const outboxJobs =
      query.source === 'queue' ? [] : await this.listOutbox(organizationId, query, limit);
    const queueJobs =
      query.source === 'outbox' ? [] : await this.listQueues(limit);

    return {
      jobs: [...outboxJobs, ...queueJobs].slice(0, limit),
      counts: { outbox: outboxJobs.length, queue: queueJobs.length },
    };
  }

  /** Outbox rows for this org in the requested status (dead ones by default). */
  private async listOutbox(
    organizationId: string,
    query: ListJobsQueryDto,
    limit: number,
  ): Promise<FailedJobResponseDto[]> {
    const db = this.prisma.tenantFor(organizationId);
    const rows = await db.outboxEvent.findMany({
      where: {
        organizationId,
        // The filter is honoured exactly. A `FAILED` row is one whose dispatch
        // was not acknowledged and which is still scheduled to retry; it is
        // not the same as a dead one, and asking for it should not hand back
        // the dead list instead.
        status: query.status ?? 'DEAD',
      },
      orderBy: { deadAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      source: 'outbox' as const,
      name: row.type,
      status: row.status,
      reason: row.lastError,
      attempts: row.attemptCount,
      failedAt: (row.deadAt ?? row.updatedAt).toISOString(),
      // The aggregate the event was about, and the correlation id that ties
      // the failure back to a request. Ids, not contents.
      reference: {
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        ...(row.correlationId ? { correlationId: row.correlationId } : {}),
      },
    }));
  }

  /** Failed BullMQ jobs across the registered queues. */
  private async listQueues(limit: number): Promise<FailedJobResponseDto[]> {
    const jobs: FailedJobResponseDto[] = [];

    for (const [queueName, queue] of this.queues) {
      let failed: FailedQueueJob[];
      try {
        failed = (await queue.getJobs(
          ['failed'],
          0,
          limit - 1,
          false,
        )) as unknown as FailedQueueJob[];
      } catch (err) {
        // A queue that cannot be reached must not take the whole listing down:
        // the outbox half is still useful, and the reason is logged.
        this.logger.warn(
          `could not read failed jobs from queue ${queueName}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      for (const job of failed) {
        jobs.push({
          id: job.id ?? `${queueName}:unknown`,
          source: 'queue' as const,
          name: job.name || queueName,
          status: 'FAILED',
          reason: job.failedReason ?? null,
          attempts: job.attemptsMade,
          failedAt: new Date(job.timestamp).toISOString(),
          reference: referenceFromJobData(job.data),
        });
      }
    }

    return jobs;
  }

  /**
   * Requeues a dead outbox event: the row goes back to `PENDING` with its
   * attempt counter reset, so the next drain picks it up. The event is
   * dispatched again, which is safe by construction — every consumer is
   * idempotent on the source event id.
   */
  async requeueOutboxEvent(id: string): Promise<{ id: string; action: 'requeued' }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const row = await db.outboxEvent.findFirst({ where: { id, organizationId } });
    if (!row) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Failed job not found.',
      });
    }
    if (row.status !== 'DEAD' && row.status !== 'FAILED') {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: `Only a dead or failed job can be requeued; this one is ${row.status}.`,
      });
    }

    await db.outboxEvent.update({
      where: { id },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        deadAt: null,
      },
    });

    await this.audit.record({
      action: 'admin_job.outbox.requeued',
      resource: 'outboxEvent',
      resourceId: id,
      metadata: { type: row.type, attempts: row.attemptCount },
    });

    return { id, action: 'requeued' };
  }

  /**
   * Discards a dead outbox event. The row is kept and marked `DISCARDED`
   * rather than deleted: the fact that an event could not be delivered is
   * part of the record, and a silent delete would hide it.
   */
  async discardOutboxEvent(id: string): Promise<{ id: string; action: 'discarded' }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const row = await db.outboxEvent.findFirst({ where: { id, organizationId } });
    if (!row) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Failed job not found.',
      });
    }
    if (row.status !== 'DEAD' && row.status !== 'FAILED') {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: `Only a dead or failed job can be discarded; this one is ${row.status}.`,
      });
    }

    await db.outboxEvent.update({
      where: { id },
      data: { status: 'DISCARDED', deadAt: new Date() },
    });

    await this.audit.record({
      action: 'admin_job.outbox.discarded',
      resource: 'outboxEvent',
      resourceId: id,
      metadata: { type: row.type, attempts: row.attemptCount },
    });

    return { id, action: 'discarded' };
  }

  /** Requeues a failed BullMQ job. */
  async requeueQueueJob(
    queueName: string,
    jobId: string,
  ): Promise<{ id: string; action: 'requeued' }> {
    const queue = this.queueFor(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Failed job not found.',
      });
    }
    await job.retry();

    await this.audit.record({
      action: 'admin_job.queue.requeued',
      resource: 'bullJob',
      resourceId: jobId,
      metadata: { queue: queueName, name: job.name },
    });

    return { id: jobId, action: 'requeued' };
  }

  /** Discards a failed BullMQ job: it is removed from the failed set. */
  async discardQueueJob(
    queueName: string,
    jobId: string,
  ): Promise<{ id: string; action: 'discarded' }> {
    const queue = this.queueFor(queueName);
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Failed job not found.',
      });
    }
    await job.discard();

    await this.audit.record({
      action: 'admin_job.queue.discarded',
      resource: 'bullJob',
      resourceId: jobId,
      metadata: { queue: queueName, name: job.name },
    });

    return { id: jobId, action: 'discarded' };
  }

  private queueFor(queueName: string): Queue {
    const queue = this.queues.get(queueName as AdminQueueName);
    if (!queue) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Unknown queue: ${queueName}`,
      });
    }
    return queue;
  }
}

/**
 * Extracts ids from a job payload for the listing's `reference`.
 *
 * A job payload is ids-only by construction, but the listing shows them as a
 * named reference rather than dumping the object, so the shape of the admin
 * surface does not change if a payload grows a field.
 */
function referenceFromJobData(data: unknown): Record<string, string> | null {
  if (typeof data !== 'object' || data === null) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}
