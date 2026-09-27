import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ENV, type Env } from '../../config/config.module';
import {
  EmergencyIntakeService,
  ESCALATION_JOB,
  ESCALATION_QUEUE,
  MAINTENANCE_JOB,
} from './emergency-intake.service';

interface EscalationJobData {
  requestId: string;
  organizationId: string;
  level: number;
}

const MAINTENANCE_JOB_ID = 'careos-emergency-maintenance';

/**
 * Unified worker for the `emergency-escalation` queue (ADR-043). It (1) delivers
 * the SLA escalation jobs — all state changes run in the service under an
 * exactly-once guarded `updateMany`, so restarts/retries can never double-
 * escalate — and (2) registers one repeatable `maintenance` job per process
 * that runs escalation reconciliation (re-promote lost SLA jobs) plus PII
 * retention. The repeatable scheduler is not registered under NODE_ENV=test so
 * deterministic e2e runs are never mutated mid-spec; the reconciler itself is
 * safe to race the delayed jobs because writing an escalation level is guarded.
 */
@Processor(ESCALATION_QUEUE)
export class EmergencyIntakeWorker extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmergencyIntakeWorker.name);

  constructor(
    private readonly intake: EmergencyIntakeService,
    @InjectQueue(ESCALATION_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return;
    try {
      await this.queue.add(
        MAINTENANCE_JOB,
        {},
        { jobId: MAINTENANCE_JOB_ID, repeat: { every: this.env.EMERGENCY_SWEEP_INTERVAL_MS } },
      );
      this.logger.log(
        `emergency maintenance sweep running every ${this.env.EMERGENCY_SWEEP_INTERVAL_MS}ms`,
      );
    } catch (err) {
      this.logger.warn(
        `maintenance sweep not scheduled: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name === MAINTENANCE_JOB) {
      try {
        const reconciled = await this.intake.reconcileEscalations();
        const retained = await this.intake.applyRetention();
        this.logger.log(
          `maintenance complete: reconcile ${JSON.stringify(reconciled)}, retention ${JSON.stringify(retained)}`,
        );
        return;
      } catch (err) {
        this.logger.error(
          `maintenance sweep failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }

    if (job.name !== ESCALATION_JOB) return;
    const { requestId, organizationId, level } = job.data as EscalationJobData;
    try {
      const outcome = await this.intake.attemptEscalation(requestId, organizationId, level);
      if (outcome === 'advanced') {
        this.logger.log(`escalated emergency request ${requestId} to level ${level}`);
      }
    } catch (err) {
      this.logger.error(
        `escalation job failed for ${requestId}@${level}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}