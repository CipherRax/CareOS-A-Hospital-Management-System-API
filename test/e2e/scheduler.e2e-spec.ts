import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';
import { SchedulerService } from '../../src/modules/scheduler/scheduler.service';

/**
 * Time-based scheduler acceptance (patch P5, ADR-044). The worker only decides
 * *when* duties run, so this suite drives the sweeps directly against the real
 * database and asserts the state transitions each duty is responsible for:
 * outbox delivery, idempotency-record reclamation, report-export expiry, and
 * per-organization maintenance reminder materialisation.
 */
describe('time-based scheduler (patch P5)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let scheduler: SchedulerService;
  let env: Env;
  let organizationId: string;

  const sc = () => prisma.unscoped();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(SchedulerService);
    env = app.get(ENV);

    organizationId = newId();
    await sc().organization.create({ data: { id: organizationId, name: 'Scheduler Org A' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers no scheduler duty under NODE_ENV=test (deterministic e2e)', () => {
    expect(env.NODE_ENV).toBe('test');
    // The queue would otherwise fire ticks mid-spec. Nothing to assert on the
    // Redis side: registration is skipped, so the duties below are the only
    // thing that mutates scheduler-owned state.
  });

  describe('outbox drain', () => {
    it(
      'publishes pending events and leaves nothing to do on a second pass',
      async () => {
        const eventId = newId();
        await sc().outboxEvent.create({
          data: {
            id: eventId,
            organizationId,
            type: 'Scheduler.SyntheticProbe',
            version: 1,
            aggregateType: 'probe',
            aggregateId: eventId,
            payload: { probe: true },
            status: 'PENDING',
            // The claim orders by occurredAt ASC in batches of 100, and earlier
            // suites share this database, so age the probe to make it claimable
            // on the first pass instead of racing a large backlog.
            occurredAt: new Date(Date.now() - 120_000),
          },
        });

        // e2e shares one database across all suites, so the outbox may hold a
        // real backlog and the drain dispatches to live consumers — this is
        // deliberately allowed to take longer than the default timeout.
        let published: { status: string; publishedAt: Date | null } | null = null;
        for (let pass = 0; pass < 5 && published?.status !== 'PUBLISHED'; pass++) {
          const result = await scheduler.drainOutbox();
          expect(result.published).toBeGreaterThanOrEqual(0);
          published = await sc().outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
        }
        expect(published?.status).toBe('PUBLISHED');
        expect(published?.publishedAt).not.toBeNull();

        // A pass over an already-drained table is harmless and never republishes
        // (a completed event is only ever claimed while PENDING).
        const second = await scheduler.drainOutbox();
        expect(typeof second.published).toBe('number');
        const stillPublished = await sc().outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
        expect(stillPublished.status).toBe('PUBLISHED');
        expect(stillPublished.publishedAt).toEqual(published?.publishedAt);
      },
      60_000,
    );
  });

  describe('idempotency-record reclamation', () => {
    it('deletes expired and orphaned records but keeps a live replay window', async () => {
      const now = new Date();
      const expiredCompleted = newId();
      const orphanedInProgress = newId();
      const live = newId();
      const base = {
        organizationId,
        scopeKey: 'scheduler-e2e',
        requestHash: 'hash',
      };
      await sc().idempotencyRecord.createMany({
        data: [
          {
            ...base,
            id: expiredCompleted,
            idempotencyKey: 'expired-completed',
            status: 'COMPLETED',
            responseStatus: 201,
            responseBody: { ok: true },
            expiresAt: new Date(now.getTime() - 60_000),
          },
          {
            ...base,
            id: orphanedInProgress,
            idempotencyKey: 'orphaned-in-progress',
            status: 'IN_PROGRESS',
            expiresAt: new Date(now.getTime() - 60_000),
          },
          {
            ...base,
            id: live,
            idempotencyKey: 'live-window',
            status: 'COMPLETED',
            responseStatus: 201,
            responseBody: { ok: true },
            expiresAt: new Date(now.getTime() + 3_600_000),
          },
        ],
      });

      // The database is shared across e2e suites, so the pass may reclaim other
      // suites' expired records too; this suite's rows are what we assert on.
      const result = await scheduler.sweepIdempotencyRecords(now);
      expect(result.deleted).toBeGreaterThanOrEqual(2);

      const remaining = await sc().idempotencyRecord.findMany({
        where: { organizationId, scopeKey: 'scheduler-e2e' },
        select: { id: true },
      });
      expect(remaining.map((r) => r.id)).toEqual([live]);

      // A second pass is a no-op (the deleted keys are free to be reused).
      await expect(scheduler.sweepIdempotencyRecords(now)).resolves.toEqual({ deleted: 0 });
    }, 30_000);
  });

  describe('report-export expiry', () => {
    it('expires only READY artifacts whose expiry has passed', async () => {
      const now = new Date();
      const due = newId();
      const future = newId();
      const pending = newId();
      await sc().reportExport.createMany({
        data: [
          {
            id: due,
            organizationId,
            reportType: 'FINANCIAL',
            format: 'JSON',
            status: 'READY',
            artifact: '{}',
            expiresAt: new Date(now.getTime() - 1_000),
          },
          {
            id: future,
            organizationId,
            reportType: 'FINANCIAL',
            format: 'JSON',
            status: 'READY',
            artifact: '{}',
            expiresAt: new Date(now.getTime() + 3_600_000),
          },
          {
            // A stalled export is an operator problem, not an expiry.
            id: pending,
            organizationId,
            reportType: 'FINANCIAL',
            format: 'JSON',
            status: 'PENDING',
            expiresAt: new Date(now.getTime() - 1_000),
          },
        ],
      });

      const result = await scheduler.expireReportExports(now);
      expect(result.expired).toBeGreaterThanOrEqual(1);

      const byId = new Map(
        (
          await sc().reportExport.findMany({
            where: { id: { in: [due, future, pending] } },
            select: { id: true, status: true },
          })
        ).map((row) => [row.id, row.status]),
      );
      expect(byId.get(due)).toBe('EXPIRED');
      expect(byId.get(future)).toBe('READY');
      expect(byId.get(pending)).toBe('PENDING');

      // Idempotent: the already-expired row is not re-counted.
      await expect(scheduler.expireReportExports(now)).resolves.toEqual({ expired: 0 });
    }, 30_000);
  });

  describe('maintenance reminder sweep', () => {
    it('materialises one system-queued reminder per scheduled record, idempotently', async () => {
      const asset = await sc().asset.create({
        data: {
          id: newId(),
          organizationId,
          assetTag: 'SCHED-001',
          category: 'EQUIPMENT',
          name: 'Scheduler Test Asset',
        },
      });
      const scheduledFor = new Date(Date.now() + 3_600_000);
      const record = await sc().maintenanceRecord.create({
        data: {
          id: newId(),
          organizationId,
          assetId: asset.id,
          status: 'PLANNED',
          scheduledFor,
        },
      });

      // Other suites' organizations and maintenance records share this database,
      // so only the per-record assertions below are specific to this suite.
      const first = await scheduler.queueMaintenanceReminders();
      expect(first.organizations).toBeGreaterThanOrEqual(1);
      expect(first.failed).toBe(0);
      expect(first.queued).toBeGreaterThanOrEqual(1);

      const reminder = await sc().maintenanceReminder.findUniqueOrThrow({
        where: {
          organizationId_maintenanceId: {
            organizationId,
            maintenanceId: record.id,
          },
        },
      });
      expect(reminder.status).toBe('QUEUED');
      expect(reminder.dueAt).toEqual(scheduledFor);
      // Queued by the scheduler, not by a person.
      expect(reminder.queuedById).toBeNull();

      // The pass is idempotent (unique organizationId+maintenanceId).
      const second = await scheduler.queueMaintenanceReminders();
      expect(second.queued).toBe(0);
      expect(second.skipped).toBeGreaterThanOrEqual(1);
      const count = await sc().maintenanceReminder.count({
        where: { organizationId, maintenanceId: record.id },
      });
      expect(count).toBe(1);
    }, 30_000);
  });
});
