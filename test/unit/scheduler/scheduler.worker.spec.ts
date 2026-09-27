import { SchedulerWorker } from '../../../src/modules/scheduler/scheduler.worker';
import {
  IDEMPOTENCY_SWEEP_JOB,
  MAINTENANCE_REMINDER_JOB,
  OUTBOX_DRAIN_JOB,
  REPORT_EXPIRY_JOB,
} from '../../../src/modules/scheduler/scheduler.service';

function makeWorker(env: Record<string, unknown> = {}) {
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const scheduler = {
    drainOutbox: jest.fn().mockResolvedValue({ published: 0 }),
    queueMaintenanceReminders: jest.fn().mockResolvedValue({
      organizations: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
    }),
    sweepIdempotencyRecords: jest.fn().mockResolvedValue({ deleted: 0 }),
    expireReportExports: jest.fn().mockResolvedValue({ expired: 0 }),
  };
  const worker = new SchedulerWorker(scheduler as never, queue as never, {
    NODE_ENV: 'production',
    SCHEDULER_ENABLED: true,
    OUTBOX_DRAIN_INTERVAL_MS: 5_000,
    MAINTENANCE_REMINDER_INTERVAL_MS: 900_000,
    IDEMPOTENCY_SWEEP_INTERVAL_MS: 3_600_000,
    REPORT_EXPIRY_INTERVAL_MS: 300_000,
    ...env,
  } as never);
  return { worker, queue, scheduler };
}

describe('SchedulerWorker', () => {
  describe('onApplicationBootstrap', () => {
    it('registers one repeatable job per duty with a stable, colon-free jobId', async () => {
      const { worker, queue } = makeWorker();

      await worker.onApplicationBootstrap();

      expect(queue.add).toHaveBeenCalledTimes(4);
      const calls = queue.add.mock.calls.map((call) => call as [string, unknown, Record<string, unknown>]);
      for (const [name, , opts] of calls) {
        expect(typeof name).toBe('string');
        // P3 rule: BullMQ jobIds must not contain ':'.
        expect(String(opts.jobId)).not.toContain(':');
        expect(opts.repeat).toEqual({ every: expect.any(Number) });
      }
      const byName = new Map(calls.map(([name, , opts]) => [name, opts]));
      expect(byName.get(OUTBOX_DRAIN_JOB)?.repeat).toEqual({ every: 5_000 });
      expect(byName.get(MAINTENANCE_REMINDER_JOB)?.repeat).toEqual({ every: 900_000 });
      expect(byName.get(IDEMPOTENCY_SWEEP_JOB)?.repeat).toEqual({ every: 3_600_000 });
      expect(byName.get(REPORT_EXPIRY_JOB)?.repeat).toEqual({ every: 300_000 });
    });

    it('registers nothing under NODE_ENV=test so e2e stays deterministic', async () => {
      const { worker, queue } = makeWorker({ NODE_ENV: 'test' });

      await worker.onApplicationBootstrap();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('honours the SCHEDULER_ENABLED kill-switch', async () => {
      const { worker, queue } = makeWorker({ SCHEDULER_ENABLED: false });

      await worker.onApplicationBootstrap();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('registers the remaining duties when one cannot be scheduled', async () => {
      const { worker, queue } = makeWorker();
      queue.add.mockRejectedValueOnce(new Error('redis unavailable'));

      await expect(worker.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(queue.add).toHaveBeenCalledTimes(4);
    });
  });

  describe('process', () => {
    it('routes each job name to its duty', async () => {
      const { worker, scheduler } = makeWorker();

      await worker.process({ name: OUTBOX_DRAIN_JOB } as never);
      await worker.process({ name: MAINTENANCE_REMINDER_JOB } as never);
      await worker.process({ name: IDEMPOTENCY_SWEEP_JOB } as never);
      await worker.process({ name: REPORT_EXPIRY_JOB } as never);

      expect(scheduler.drainOutbox).toHaveBeenCalledTimes(1);
      expect(scheduler.queueMaintenanceReminders).toHaveBeenCalledTimes(1);
      expect(scheduler.sweepIdempotencyRecords).toHaveBeenCalledTimes(1);
      expect(scheduler.expireReportExports).toHaveBeenCalledTimes(1);
    });

    it('ignores an unknown job name instead of running the wrong duty', async () => {
      const { worker, scheduler } = makeWorker();

      await expect(worker.process({ name: 'nonsense' } as never)).resolves.toBeUndefined();
      expect(scheduler.drainOutbox).not.toHaveBeenCalled();
      expect(scheduler.sweepIdempotencyRecords).not.toHaveBeenCalled();
    });

    it('lets a failing duty reject so BullMQ retries the tick', async () => {
      const { worker, scheduler } = makeWorker();
      scheduler.sweepIdempotencyRecords.mockRejectedValue(new Error('db down'));

      await expect(worker.process({ name: IDEMPOTENCY_SWEEP_JOB } as never)).rejects.toThrow('db down');
    });
  });
});
