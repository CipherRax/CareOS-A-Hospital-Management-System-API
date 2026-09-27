import {
  IDEMPOTENCY_SWEEP_JOB,
  MAINTENANCE_REMINDER_JOB,
  OUTBOX_DRAIN_JOB,
  REPORT_EXPIRY_JOB,
  SchedulerService,
} from '../../../src/modules/scheduler/scheduler.service';

interface Mocks {
  idempotencyRecord: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  reportExport: {
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  organization: { findMany: jest.Mock };
}

function makeMocks(): Mocks {
  return {
    idempotencyRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    reportExport: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    organization: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeService(mocks: Mocks, env: Record<string, unknown> = {}) {
  const prisma = { unscoped: jest.fn(() => mocks) };
  const maintenance = { queueReminders: jest.fn().mockResolvedValue({ queued: 0, skipped: 0 }) };
  const publisher = { publishReadyEvents: jest.fn().mockResolvedValue(0) };
  const service = new SchedulerService(
    prisma as never,
    maintenance as never,
    publisher as never,
    {
      SCHEDULER_SWEEP_BATCH: 500,
      SCHEDULER_ORG_BATCH: 2,
      ...env,
    } as never,
  );
  return { service, prisma, maintenance, publisher, mocks };
}

describe('SchedulerService', () => {
  describe('drainOutbox', () => {
    it('delegates to the outbox publisher with a bounded batch', async () => {
      const { service, publisher } = makeService(makeMocks());
      publisher.publishReadyEvents.mockResolvedValue(3);

      await expect(service.drainOutbox()).resolves.toEqual({ published: 3 });
      expect(publisher.publishReadyEvents).toHaveBeenCalledWith(100);
    });

    it('propagates a publisher failure so BullMQ can retry the tick', async () => {
      const { service, publisher } = makeService(makeMocks());
      publisher.publishReadyEvents.mockRejectedValue(new Error('redis down'));

      await expect(service.drainOutbox()).rejects.toThrow('redis down');
    });
  });

  describe('sweepIdempotencyRecords', () => {
    it('deletes only records past their expiry, in bounded pages', async () => {
      const mocks = makeMocks();
      mocks.idempotencyRecord.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      mocks.idempotencyRecord.deleteMany.mockResolvedValue({ count: 2 });
      const { service } = makeService(mocks);
      const now = new Date('2026-10-02T00:00:00.000Z');

      await expect(service.sweepIdempotencyRecords(now)).resolves.toEqual({ deleted: 2 });

      expect(mocks.idempotencyRecord.findMany).toHaveBeenCalledWith({
        where: { expiresAt: { lte: now } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: 500,
      });
      expect(mocks.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] } },
      });
    });

    it('is a no-op (no delete) when nothing has expired', async () => {
      const mocks = makeMocks();
      const { service } = makeService(mocks);

      await expect(service.sweepIdempotencyRecords()).resolves.toEqual({ deleted: 0 });
      expect(mocks.idempotencyRecord.deleteMany).not.toHaveBeenCalled();
    });

    it('honours a custom batch size so a backlog drains over several ticks', async () => {
      const mocks = makeMocks();
      mocks.idempotencyRecord.findMany.mockResolvedValue([]);
      const { service } = makeService(mocks, { SCHEDULER_SWEEP_BATCH: 10 });

      await service.sweepIdempotencyRecords();
      expect(mocks.idempotencyRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('expireReportExports', () => {
    it('flips READY exports whose expiry passed, re-asserting READY on write', async () => {
      const mocks = makeMocks();
      mocks.reportExport.findMany.mockResolvedValue([{ id: 'exp-1' }]);
      mocks.reportExport.updateMany.mockResolvedValue({ count: 1 });
      const { service } = makeService(mocks);
      const now = new Date('2026-10-02T00:00:00.000Z');

      await expect(service.expireReportExports(now)).resolves.toEqual({ expired: 1 });

      expect(mocks.reportExport.findMany).toHaveBeenCalledWith({
        where: { status: 'READY', expiresAt: { lte: now } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: 500,
      });
      expect(mocks.reportExport.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['exp-1'] }, status: 'READY' },
        data: { status: 'EXPIRED' },
      });
    });

    it('counts a lost race as 0 expired (another pass or operator won)', async () => {
      const mocks = makeMocks();
      mocks.reportExport.findMany.mockResolvedValue([{ id: 'exp-1' }]);
      mocks.reportExport.updateMany.mockResolvedValue({ count: 0 });
      const { service } = makeService(mocks);

      await expect(service.expireReportExports()).resolves.toEqual({ expired: 0 });
    });

    it('is a no-op when no export is due', async () => {
      const mocks = makeMocks();
      const { service } = makeService(mocks);

      await expect(service.expireReportExports()).resolves.toEqual({ expired: 0 });
      expect(mocks.reportExport.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('queueMaintenanceReminders', () => {
    it('runs the reminder pass per organization with an explicit org and no actor', async () => {
      const mocks = makeMocks();
      mocks.organization.findMany.mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]);
      const { service, maintenance } = makeService(mocks);
      maintenance.queueReminders
        .mockResolvedValueOnce({ queued: 2, skipped: 1 })
        .mockResolvedValueOnce({ queued: 0, skipped: 4 });

      await expect(service.queueMaintenanceReminders()).resolves.toEqual({
        organizations: 2,
        queued: 2,
        skipped: 5,
        failed: 0,
      });
      expect(maintenance.queueReminders).toHaveBeenNthCalledWith(1, {
        organizationId: 'org-1',
        actorId: null,
      });
      expect(maintenance.queueReminders).toHaveBeenNthCalledWith(2, {
        organizationId: 'org-2',
        actorId: null,
      });
    });

    it('isolates a failing organization so the rest of the pass still runs', async () => {
      const mocks = makeMocks();
      mocks.organization.findMany.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
      const { service, maintenance } = makeService(mocks);
      maintenance.queueReminders
        .mockRejectedValueOnce(new Error('org quarantined'))
        .mockResolvedValueOnce({ queued: 1, skipped: 0 });

      await expect(service.queueMaintenanceReminders()).resolves.toEqual({
        organizations: 2,
        queued: 1,
        skipped: 0,
        failed: 1,
      });
    });

    it('rotates through organizations with a UUIDv7 cursor instead of starving the tail', async () => {
      const mocks = makeMocks();
      // Three orgs, a page size of two: pass one takes the first two, pass two
      // takes the short tail, pass three finds nothing past the cursor and wraps.
      mocks.organization.findMany
        .mockResolvedValueOnce([{ id: 'org-1' }, { id: 'org-2' }])
        .mockResolvedValueOnce([{ id: 'org-3' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'org-1' }, { id: 'org-2' }]);
      const { service } = makeService(mocks);

      const page = { select: { id: true }, orderBy: { id: 'asc' }, take: 2 };

      await service.queueMaintenanceReminders();
      expect(mocks.organization.findMany).toHaveBeenNthCalledWith(1, {
        ...page,
        where: undefined,
      });

      // Pass two resumes after the cursor rather than re-reading page one.
      await service.queueMaintenanceReminders();
      expect(mocks.organization.findMany).toHaveBeenNthCalledWith(2, {
        ...page,
        where: { id: { gt: 'org-2' } },
      });

      // Past the last org -> wrap back to the first page within the same pass.
      await service.queueMaintenanceReminders();
      expect(mocks.organization.findMany).toHaveBeenNthCalledWith(3, {
        ...page,
        where: { id: { gt: 'org-3' } },
      });
      expect(mocks.organization.findMany).toHaveBeenNthCalledWith(4, {
        ...page,
        where: undefined,
      });
    });

    it('keeps the cursor when a pass returns nothing at all', async () => {
      const mocks = makeMocks();
      mocks.organization.findMany.mockResolvedValue([]);
      const { service } = makeService(mocks);

      await expect(service.queueMaintenanceReminders()).resolves.toEqual({
        organizations: 0,
        queued: 0,
        skipped: 0,
        failed: 0,
      });
      expect(mocks.organization.findMany).toHaveBeenCalledWith({
        where: undefined,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 2,
      });
    });
  });

  describe('duty names', () => {
    it('exposes one distinct name per time-based duty', () => {
      expect(new Set([OUTBOX_DRAIN_JOB, MAINTENANCE_REMINDER_JOB, IDEMPOTENCY_SWEEP_JOB, REPORT_EXPIRY_JOB]).size).toBe(4);
    });
  });
});
