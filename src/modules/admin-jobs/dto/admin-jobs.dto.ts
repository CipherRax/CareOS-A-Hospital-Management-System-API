import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Admin job inspection (brief §5.9). The listing is deliberately narrow: a
 * job name, the reason it failed, how many attempts it took, when it failed,
 * and a *reference* to what it was working on. Never the payload itself —
 * an admin screen is not the place for patient data to end up.
 */
export const ListJobsQuerySchema = z.object({
  /** Restrict to one source: 'outbox' or 'queue'. */
  source: z.enum(['outbox', 'queue']).optional(),
  /**
   * The outbox status to list. Defaults to `DEAD` — the events that have
   * exhausted their retries. `FAILED` is an event whose last dispatch was not
   * acknowledged and which is still scheduled to retry; `DISCARDED` is one an
   * administrator has given up on.
   */
  status: z.enum(['DEAD', 'FAILED', 'DISCARDED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export class ListJobsQueryDto extends createZodDto(ListJobsQuerySchema) {}

export class FailedJobResponseDto {
  /** Stable identifier: the outbox event id or the BullMQ job id. */
  id!: string;
  /** Which surface the failure lives on. */
  source!: 'outbox' | 'queue';
  /** The job/event name, e.g. 'emergency-escalation' or an event type. */
  name!: string;
  status!: string;
  /** Why it failed, as recorded by the producer. */
  reason?: string | null;
  attempts!: number;
  failedAt!: string;
  /** Ids the job was working on. Never the payload. */
  reference?: Record<string, string> | null;
}

export class ListJobsResponseDto {
  jobs!: FailedJobResponseDto[];
  /** Counts by source, so an operator sees the shape at a glance. */
  counts!: { outbox: number; queue: number };
}

export class JobActionResponseDto {
  id!: string;
  action!: 'requeued' | 'discarded';
}

/** The body for the queue-job actions: which job, on which queue. */
export const QueueJobActionSchema = z.object({
  jobId: z.string().min(1).max(200),
});
export class QueueJobActionDto extends createZodDto(QueueJobActionSchema) {}
