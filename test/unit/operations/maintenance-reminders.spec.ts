import { MaintenanceService } from '../../../src/modules/operations/maintenance.service';
import type { TxContext } from '../../../src/database/tx';

type ReminderPass = { queued: number; skipped: number };

/**
 * Scope resolution for the idempotent reminder scan (ADR-044). Two callers share
 * one implementation: the HTTP route (ambient tenant scope) and the scheduler
 * (explicit organization, system actor, no CLS scope at all).
 */
function makeService(scope: { organizationId?: string | null; userId?: string | null } = {}) {
  const tenantContext = {
    requireOrg: jest.fn(() => {
      if (scope.organizationId === undefined || scope.organizationId === null) {
        throw new Error('TenantRequiredError');
      }
      return scope.organizationId;
    }),
    requireUserId: jest.fn(() => {
      if (scope.userId === undefined || scope.userId === null) {
        throw new Error('TenantRequiredError');
      }
      return scope.userId;
    }),
  };

  const maintenanceRecord = {
    findMany: jest.fn().mockResolvedValue([{ id: 'm-1', scheduledFor: new Date() }]),
  };
  const maintenanceReminder = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'r-1' }),
  };
  const ctx = {
    db: { maintenanceRecord, maintenanceReminder },
    organizationId: 'org-1',
    emit: jest.fn(),
  } as unknown as TxContext;

  const txRunner = {
    run: jest.fn(
      async (
        _work: (c: TxContext) => Promise<unknown>,
        _options?: { organizationId?: string },
      ) => ({ queued: 1, skipped: 0 }),
    ),
  };
  const prisma = { tenantFor: jest.fn() };

  const service = new MaintenanceService(
    prisma as never,
    tenantContext as never,
    txRunner as never,
  );

  /** Makes the mocked transaction actually run its callback against `fakeCtx`. */
  const runWith = (fakeCtx: TxContext) => {
    txRunner.run.mockImplementation(
      async (work) => (await work(fakeCtx)) as ReminderPass,
    );
  };

  return { service, tenantContext, txRunner, ctx, runWith, maintenanceRecord, maintenanceReminder };
}

describe('MaintenanceService.queueReminders scope resolution', () => {
  it('uses the ambient tenant scope when called over HTTP', async () => {
    const { service, tenantContext, txRunner, ctx, runWith, maintenanceReminder } = makeService({
      organizationId: 'org-http',
      userId: 'user-1',
    });
    runWith(ctx);

    await expect(service.queueReminders()).resolves.toEqual({ queued: 1, skipped: 0 });

    expect(tenantContext.requireOrg).toHaveBeenCalled();
    expect(tenantContext.requireUserId).toHaveBeenCalled();
    // The transaction is explicitly scoped so it is correct either way.
    expect(txRunner.run).toHaveBeenCalledWith(expect.any(Function), {
      organizationId: 'org-http',
    });
    expect(maintenanceReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ queuedById: 'user-1' }) }),
    );
  });

  it('accepts an explicit organization and a null actor from the scheduler', async () => {
    const { service, tenantContext, txRunner, ctx, runWith, maintenanceReminder } = makeService();
    runWith(ctx);

    await expect(
      service.queueReminders({ organizationId: 'org-cron', actorId: null }),
    ).resolves.toEqual({ queued: 1, skipped: 0 });

    // A background pass has no CLS scope, so neither accessor may be consulted.
    expect(tenantContext.requireOrg).not.toHaveBeenCalled();
    // Regression: `actorId: null` is meaningful and must not fall through to
    // `requireUserId()` via `??` (null is a real value here — nobody queued it).
    expect(tenantContext.requireUserId).not.toHaveBeenCalled();
    expect(txRunner.run).toHaveBeenCalledWith(expect.any(Function), {
      organizationId: 'org-cron',
    });
    expect(maintenanceReminder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ queuedById: null }) }),
    );
  });

  it('skips a record that already has a reminder (idempotent re-run)', async () => {
    const { service, ctx, runWith, maintenanceReminder } = makeService();
    runWith(ctx);
    maintenanceReminder.findUnique.mockResolvedValue({ id: 'r-existing' });

    await expect(
      service.queueReminders({ organizationId: 'org-cron', actorId: null }),
    ).resolves.toEqual({ queued: 0, skipped: 1 });
    expect(maintenanceReminder.create).not.toHaveBeenCalled();
  });

  it('emits MaintenanceReminderQueued with the maintenance id in the payload', async () => {
    const { service, ctx, runWith } = makeService();
    runWith(ctx);

    await service.queueReminders({ organizationId: 'org-cron', actorId: null });

    expect(ctx.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'maintenance',
        aggregateId: expect.any(String),
        payload: expect.objectContaining({ maintenanceId: 'm-1' }),
      }),
    );
  });
});
