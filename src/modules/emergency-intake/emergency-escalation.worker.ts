import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EmergencyIntakeService, ESCALATION_JOB } from './emergency-intake.service';

interface EscalationJobData {
  requestId: string;
  organizationId: string;
  level: number;
}

/**
 * Delivers the SLA escalation jobs for anonymous emergency requests. The
 * processor is a pure trigger: all state changes run in the service with an
 * exactly-once guard, so worker restarts/retries can never double-escalate.
 */
@Processor('emergency-escalation')
export class EmergencyEscalationProcessor extends WorkerHost {
  private readonly logger = new Logger(EmergencyEscalationProcessor.name);

  constructor(private readonly intake: EmergencyIntakeService) {
    super();
  }

  async process(job: Job<EscalationJobData>): Promise<void> {
    if (job.name !== ESCALATION_JOB) return;
    const { requestId, organizationId, level } = job.data;
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