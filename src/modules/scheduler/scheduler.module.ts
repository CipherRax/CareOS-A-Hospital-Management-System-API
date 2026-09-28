import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullQueuesModule } from '../../jobs/bull-queues.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationsModule } from '../operations/operations.module';
import { SCHEDULER_QUEUE, SchedulerService } from './scheduler.service';
import { SchedulerWorker } from './scheduler.worker';

/**
 * Time-based scheduler (patch P5, ADR-044). Holds no routes: it is the timer
 * that makes the platform's own housekeeping happen without an HTTP call —
 * outbox delivery, maintenance reminders, idempotency reclamation, export
 * expiry, notification delivery. The work itself stays in the owning feature
 * modules; this module only decides when it runs.
 */
@Module({
  imports: [
    BullQueuesModule,
    BullModule.registerQueue({ name: SCHEDULER_QUEUE }),
    OperationsModule,
    NotificationsModule,
  ],
  providers: [SchedulerService, SchedulerWorker],
  exports: [SchedulerService],
})
export class SchedulerModule {}
