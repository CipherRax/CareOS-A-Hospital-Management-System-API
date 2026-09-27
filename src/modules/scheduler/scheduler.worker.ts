import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ENV, type Env } from '../../config/config.module';
import {
  IDEMPOTENCY_SWEEP_JOB,
  MAINTENANCE_REMINDER_JOB,
  OUTBOX_DRAIN_JOB,
  REPORT_EXPIRY_JOB,
  SCHEDULER_QUEUE,
  SchedulerService,
} from './scheduler.service';

interface Duty {
  name: string;
  /** Repeat period in ms (env-driven; see config/env.schema.ts). */
  every: number;
  /** Stable BullMQ jobId — repeatable jobs dedupe on it (no ':' allowed). */
  jobId: string;
}

/**
 * Time-based duties for the whole platform (patch P5, ADR-044).
 *
 * One repeatable job per duty, registered once per process and deduped by
 * `jobId`, so a fleet of API + worker processes schedules each duty exactly
 * once while the queue distributes the ticks. This replaces the bare
 * `setInterval` outbox poll that lived in `worker.ts` and adds the sweeps the
 * platform had no timer for (maintenance reminders, idempotency reclamation,
 * export expiry).
 *
 * Nothing is registered under `NODE_ENV=test` (deterministic e2e drives the
 * sweeps directly) or when `SCHEDULER_ENABLED=false` (operator kill-switch for
 * a worker-less deploy).
 */
@Processor(SCHEDULER_QUEUE)
export class SchedulerWorker extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerWorker.name);

  constructor(
    private readonly scheduler: SchedulerService,
    @InjectQueue(SCHEDULER_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  /** The duty table, derived from env so operators tune cadence without a code change. */
  duties(): Duty[] {
    return [
      {
        name: OUTBOX_DRAIN_JOB,
        every: this.env.OUTBOX_DRAIN_INTERVAL_MS,
        jobId: 'careos-scheduler-outbox-drain',
      },
      {
        name: MAINTENANCE_REMINDER_JOB,
        every: this.env.MAINTENANCE_REMINDER_INTERVAL_MS,
        jobId: 'careos-scheduler-maintenance-reminders',
      },
      {
        name: IDEMPOTENCY_SWEEP_JOB,
        every: this.env.IDEMPOTENCY_SWEEP_INTERVAL_MS,
        jobId: 'careos-scheduler-idempotency-sweep',
      },
      {
        name: REPORT_EXPIRY_JOB,
        every: this.env.REPORT_EXPIRY_INTERVAL_MS,
        jobId: 'careos-scheduler-report-expiry',
      },
    ];
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return;
    if (!this.env.SCHEDULER_ENABLED) {
      this.logger.warn('SCHEDULER_ENABLED=false — no time-based duty registered');
      return;
    }
    for (const duty of this.duties()) {
      try {
        await this.queue.add(duty.name, {}, {
          jobId: duty.jobId,
          repeat: { every: duty.every },
          removeOnComplete: 20,
          removeOnFail: 20,
        });
        this.logger.log(`scheduler duty '${duty.name}' every ${duty.every}ms`);
      } catch (err) {
        // A duty that cannot be scheduled (e.g. Redis briefly down) must not
        // abort the remaining registrations or crash the process.
        this.logger.warn(
          `scheduler duty '${duty.name}' not scheduled: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case OUTBOX_DRAIN_JOB: {
        const result = await this.scheduler.drainOutbox();
        if (result.published > 0) {
          this.logger.log({ published: result.published }, 'outbox events published');
        }
        return;
      }
      case MAINTENANCE_REMINDER_JOB: {
        const result = await this.scheduler.queueMaintenanceReminders();
        this.logger.log(
          `maintenance reminders: ${result.queued} queued, ${result.skipped} existing across ${result.organizations} orgs${result.failed ? `, ${result.failed} failed` : ''}`,
        );
        return;
      }
      case IDEMPOTENCY_SWEEP_JOB: {
        const result = await this.scheduler.sweepIdempotencyRecords();
        if (result.deleted > 0) {
          this.logger.log({ deleted: result.deleted }, 'expired idempotency records reclaimed');
        }
        return;
      }
      case REPORT_EXPIRY_JOB: {
        const result = await this.scheduler.expireReportExports();
        if (result.expired > 0) {
          this.logger.log({ expired: result.expired }, 'report exports expired');
        }
        return;
      }
      default:
        this.logger.warn(`unknown scheduler job '${job.name}' ignored`);
    }
  }
}
