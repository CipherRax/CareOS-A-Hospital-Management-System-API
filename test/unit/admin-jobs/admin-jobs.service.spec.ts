import { AdminJobsService } from '../../../src/modules/admin-jobs/admin-jobs.service';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { AppError } from '../../../src/common/errors/app-error';
import type { PrismaService } from '../../../src/database/prisma.service';
import type { TenantContext } from '../../../src/database/tenant-context';
import type { AuditService } from '../../../src/database/audit.service';
import type { Queue } from 'bullmq';

interface OutboxRow {
  id: string;
  organizationId: string;
  type: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED' | 'DEAD' | 'DISCARDED';
  aggregateType: string;
  aggregateId: string;
  correlationId: string | null;
  attemptCount: number;
  lastError: string | null;
  deadAt: Date | null;
  updatedAt: Date;
}

function outboxRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'evt-1',
    organizationId: 'org-1',
    type: 'patient.created',
    status: 'DEAD',
    aggregateType: 'Patient',
    aggregateId: 'pat-1',
    correlationId: 'req-1',
    attemptCount: 8,
    lastError: 'consumer timed out',
    deadAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeMocks(rows: OutboxRow[] = []) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const findFirst = jest.fn().mockImplementation(async ({ where }) => {
    const match = rows.find((r) => r.id === where.id && r.organizationId === where.organizationId);
    return match ?? null;
  });
  const update = jest.fn().mockResolvedValue({});
  const tenant = { outboxEvent: { findMany, findFirst, update } };
  const prisma = { tenantFor: jest.fn(() => tenant) };
  const tenantContext = {
    scope: { permissions: [], organizationId: 'org-1', userId: 'user-1' },
    requireOrg: jest.fn(() => 'org-1'),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const queues = new Map<string, Queue>();
  const service = new AdminJobsService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    audit as unknown as AuditService,
    queues as unknown as ReadonlyMap<never, Queue>,
  );
  return { service, findMany, findFirst, update, audit, queues, tenant };
}

describe('AdminJobsService.list', () => {
  it('lists dead outbox events with a reference but no payload', async () => {
    const { service, findMany } = makeMocks([outboxRow()]);

    const result = await service.list({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', status: 'DEAD' },
      }),
    );
    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0]!;
    expect(job).toMatchObject({
      id: 'evt-1',
      source: 'outbox',
      name: 'patient.created',
      status: 'DEAD',
      reason: 'consumer timed out',
      attempts: 8,
    });
    expect(job.reference).toEqual({
      aggregateType: 'Patient',
      aggregateId: 'pat-1',
      correlationId: 'req-1',
    });
    // The reference is ids only; the raw row never reaches the listing.
    expect(JSON.stringify(result)).not.toContain('payload');
  });

  it('scopes the outbox listing to the tenant', async () => {
    const { service, findMany } = makeMocks([]);

    await service.list({});

    const where = findMany.mock.calls[0]![0].where;
    expect(where.organizationId).toBe('org-1');
  });

  it('lists discarded events when asked', async () => {
    const { service, findMany } = makeMocks([]);

    await service.list({ status: 'DISCARDED' });

    expect(findMany.mock.calls[0]![0].where.status).toBe('DISCARDED');
  });

  it('skips the outbox half when the source filter is queue', async () => {
    const { service, findMany } = makeMocks([outboxRow()]);

    const result = await service.list({ source: 'queue' });

    expect(findMany).not.toHaveBeenCalled();
    expect(result.jobs).toHaveLength(0);
    expect(result.counts.outbox).toBe(0);
  });

  it('reports failed queue jobs with name, reason, attempts and a reference', async () => {
    const { service, queues } = makeMocks([]);
    const getJobs = jest.fn().mockResolvedValue([
      {
        id: 'job-1',
        name: 'escalate',
        data: { requestId: 'emr-1', level: 2 },
        attemptsMade: 3,
        failedReason: 'sms provider unavailable',
        timestamp: Date.parse('2026-02-02T10:00:00.000Z'),
      },
    ]);
    queues.set('emergency-escalation', { getJobs } as unknown as Queue);

    const result = await service.list({ source: 'queue' });

    expect(result.counts.queue).toBe(1);
    const job = result.jobs[0]!;
    expect(job).toMatchObject({
      id: 'job-1',
      source: 'queue',
      name: 'escalate',
      status: 'FAILED',
      reason: 'sms provider unavailable',
      attempts: 3,
    });
    // Only string ids become the reference; the numeric level is not a patient
    // identifier and is not useful on an admin screen.
    expect(job.reference).toEqual({ requestId: 'emr-1' });
  });

  it('keeps the listing alive when a queue cannot be reached', async () => {
    const { service, queues } = makeMocks([outboxRow()]);
    queues.set(
      'emergency-escalation',
      {
        getJobs: jest.fn().mockRejectedValue(new Error('redis down')),
      } as unknown as Queue,
    );

    const result = await service.list({});

    expect(result.counts.outbox).toBe(1);
    expect(result.counts.queue).toBe(0);
  });
});

describe('AdminJobsService.requeueOutboxEvent', () => {
  it('returns a dead event to PENDING with the attempt counter reset', async () => {
    const { service, update, audit } = makeMocks([outboxRow()]);

    const result = await service.requeueOutboxEvent('evt-1');

    expect(result).toEqual({ id: 'evt-1', action: 'requeued' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: expect.objectContaining({
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
        deadAt: null,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin_job.outbox.requeued', resourceId: 'evt-1' }),
    );
  });

  it('refuses to requeue an event that was never dead', async () => {
    const { service, update } = makeMocks([outboxRow({ status: 'PUBLISHED' })]);

    await expect(service.requeueOutboxEvent('evt-1')).rejects.toBeInstanceOf(AppError);
    expect(update).not.toHaveBeenCalled();
  });

  it('404s an unknown event', async () => {
    const { service } = makeMocks([]);

    await expect(service.requeueOutboxEvent('evt-nope')).rejects.toMatchObject({
      code: ErrorCodes.RESOURCE_NOT_FOUND,
    });
  });
});

describe('AdminJobsService.discardOutboxEvent', () => {
  it('marks the event DISCARDED rather than deleting it', async () => {
    const { service, update, audit } = makeMocks([outboxRow()]);

    const result = await service.discardOutboxEvent('evt-1');

    expect(result).toEqual({ id: 'evt-1', action: 'discarded' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: expect.objectContaining({ status: 'DISCARDED' }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin_job.outbox.discarded', resourceId: 'evt-1' }),
    );
  });

  it('refuses to discard an event that is still in flight', async () => {
    const { service, update } = makeMocks([outboxRow({ status: 'PENDING' })]);

    await expect(service.discardOutboxEvent('evt-1')).rejects.toBeInstanceOf(AppError);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('AdminJobsService queue actions', () => {
  it('requeues a failed queue job', async () => {
    const { service, queues, audit } = makeMocks([]);
    const retry = jest.fn().mockResolvedValue(undefined);
    const getJob = jest.fn().mockResolvedValue({ id: 'job-1', name: 'escalate', retry });
    queues.set('emergency-escalation', { getJob } as unknown as Queue);

    const result = await service.requeueQueueJob('emergency-escalation', 'job-1');

    expect(result).toEqual({ id: 'job-1', action: 'requeued' });
    expect(retry).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin_job.queue.requeued', resourceId: 'job-1' }),
    );
  });

  it('discards a failed queue job', async () => {
    const { service, queues } = makeMocks([]);
    const discard = jest.fn().mockResolvedValue(undefined);
    const getJob = jest.fn().mockResolvedValue({ id: 'job-1', name: 'escalate', discard });
    queues.set('emergency-escalation', { getJob } as unknown as Queue);

    const result = await service.discardQueueJob('emergency-escalation', 'job-1');

    expect(result).toEqual({ id: 'job-1', action: 'discarded' });
    expect(discard).toHaveBeenCalled();
  });

  it('404s an unknown queue job', async () => {
    const { service, queues } = makeMocks([]);
    queues.set(
      'emergency-escalation',
      { getJob: jest.fn().mockResolvedValue(undefined) } as unknown as Queue,
    );

    await expect(
      service.requeueQueueJob('emergency-escalation', 'job-nope'),
    ).rejects.toMatchObject({ code: ErrorCodes.RESOURCE_NOT_FOUND });
  });

  it('rejects a queue this deployment does not own', async () => {
    const { service } = makeMocks([]);

    await expect(service.requeueQueueJob('someone-elses-queue', 'job-1')).rejects.toMatchObject(
      { code: ErrorCodes.VALIDATION_ERROR },
    );
  });
});
