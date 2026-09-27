import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullQueuesModule } from '../../jobs/bull-queues.module';
import { OperationsModule } from '../operations/operations.module';
import { SCHEDULER_QUEUE, SchedulerService } from './scheduler.service';
import { SchedulerWorker } from './scheduler.worker';

/**
 * Time-based scheduler (patch P5, ADR-044). Holds no routes: it is the timer
 * that makes the platform's own housekeeping happen without an HTTP call —
 * outbox delivery, maintenance reminders, idempotency reclamation, export
 * expiry. The outbox publisher itself stays in the global outbox module; this
 * module only decides when it runs.
 */
@Module({
  imports: [BullQueuesModule, BullModule.registerQueue({ name: SCHEDULER_QUEUE }), OperationsModule],
  providers: [SchedulerService, SchedulerWorker],
  exports: [SchedulerService],
})
export class SchedulerModule {}
