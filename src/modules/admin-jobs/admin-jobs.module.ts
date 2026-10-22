import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { BullQueuesModule } from '../../jobs/bull-queues.module';
import { ESCALATION_QUEUE, SCHEDULER_QUEUE } from '../../jobs/queue-names';
import { AdminJobsController } from './admin-jobs.controller';
import { ADMIN_JOB_QUEUES_TOKEN, AdminJobsService } from './admin-jobs.service';
import { ADMIN_QUEUE_NAMES, type AdminQueueName } from './domain/admin-queues';

/**
 * Admin inspection of failed background work (brief §5.9).
 *
 * The queues are registered here as well as in their owning modules: BullMQ's
 * queue handle is a Redis reader, so a second handle on the same name reads
 * the same failed set without the admin module having to import the modules
 * that own the work.
 */
@Module({
  imports: [
    BullQueuesModule,
    BullModule.registerQueue({ name: ESCALATION_QUEUE }),
    BullModule.registerQueue({ name: SCHEDULER_QUEUE }),
  ],
  controllers: [AdminJobsController],
  providers: [
    AdminJobsService,
    {
      provide: ADMIN_JOB_QUEUES_TOKEN,
      useFactory: (
        escalation: Queue,
        scheduler: Queue,
      ): ReadonlyMap<AdminQueueName, Queue> =>
        new Map([
          [ESCALATION_QUEUE as AdminQueueName, escalation],
          [SCHEDULER_QUEUE as AdminQueueName, scheduler],
        ]),
      inject: [getQueueToken(ESCALATION_QUEUE), getQueueToken(SCHEDULER_QUEUE)],
    },
  ],
  exports: [ADMIN_JOB_QUEUES_TOKEN],
})
export class AdminJobsModule {
  /** The queues this module can inspect, for callers that build their own map. */
  static readonly queues = ADMIN_QUEUE_NAMES;
}
