import { DisplayService } from '../../../src/modules/display/display.service';

/**
 * Brief §5.16 wants a waiting-room screen that stops checking in to be visible
 * as a problem, not as a list entry someone may or may not open. The admin list
 * already *derived* a `stale` flag, which meant a dead board in a live waiting
 * room stayed silent until an operator went looking.
 *
 * The two properties that matter are: alert once per outage (a screen that is
 * simply offline must not page on every tick, or operators learn to ignore it),
 * and re-arm after recovery (a screen that comes back and dies again must be
 * heard about again).
 */
const NOW = new Date('2026-06-01T12:00:00.000Z');
/** 10 minutes, matching DEVICE_STALE_AFTER_MS in the service. */
const STALE_AFTER_MS = 10 * 60_000;

function build(options: {
  candidates?: Array<Record<string, unknown>>;
  claimCount?: number;
  recipients?: Array<{ id: string }>;
  branchName?: string | null;
  notifyThrows?: boolean;
  claimThrows?: boolean;
}) {
  const displayDevice = {
    findMany: jest.fn().mockResolvedValue(
      options.candidates ?? [
        {
          id: 'dev-1',
          organizationId: 'org-1',
          branchId: 'branch-1',
          name: 'Waiting Room A',
          lastSeenAt: new Date(NOW.getTime() - 30 * 60_000),
        },
      ],
    ),
    updateMany: options.claimThrows
      ? jest.fn().mockRejectedValue(new Error('db down'))
      : jest.fn().mockResolvedValue({ count: options.claimCount ?? 1 }),
  };
  const user = {
    findMany: jest.fn().mockResolvedValue(options.recipients ?? [{ id: 'user-1' }]),
  };
  const branch = {
    findFirst: jest.fn().mockResolvedValue(
      options.branchName === null ? null : { name: options.branchName ?? 'Main Hospital' },
    ),
  };
  const createForUser = options.notifyThrows
    ? jest.fn().mockRejectedValue(new Error('notify failed'))
    : jest.fn().mockResolvedValue({ id: 'n-1' });
  const service = new DisplayService(
    { unscoped: () => ({ displayDevice, user, branch }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { createForUser } as never,
    {} as never,
  );
  return { service, displayDevice, user, branch, createForUser };
}

describe('DisplayService.sweepStaleDevices', () => {
  it('selects only active devices that have not checked in, and only unalerted ones', async () => {
    const { service, displayDevice } = build({});
    await service.sweepStaleDevices(NOW);
    const [args] = displayDevice.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toEqual({
      status: 'ACTIVE',
      lastSeenAt: { lt: new Date(NOW.getTime() - STALE_AFTER_MS) },
      staleNotifiedAt: null,
    });
  });

  it('orders oldest-first and caps the batch', async () => {
    const { service, displayDevice } = build({});
    await service.sweepStaleDevices(NOW);
    const [args] = displayDevice.findMany.mock.calls[0] as [
      { orderBy: unknown; take: number },
    ];
    expect(args.orderBy).toEqual({ lastSeenAt: 'asc' });
    expect(args.take).toBeGreaterThan(0);
  });

  it('alerts device managers when a screen goes dark', async () => {
    const { service, createForUser } = build({});
    const out = await service.sweepStaleDevices(NOW);
    expect(out).toEqual({ detected: 1, alerted: 1, failed: 0 });
    expect(createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        templateKey: 'display.device_stale',
        channel: 'IN_APP',
      }),
    );
  });

  it('interpolates only device and branch identity, never board contents', async () => {
    const { service, createForUser } = build({});
    await service.sweepStaleDevices(NOW);
    const call = createForUser.mock.calls[0]?.[0] as {
      variables: Record<string, unknown>;
    };
    expect(Object.keys(call.variables).sort()).toEqual(['branchName', 'deviceName', 'minutes']);
    expect(call.variables.deviceName).toBe('Waiting Room A');
    expect(call.variables.branchName).toBe('Main Hospital');
  });

  it('claims the device before notifying, so a lost race stays silent', async () => {
    // Another process claimed this row between the read and our write.
    const { service, createForUser } = build({ claimCount: 0 });
    const out = await service.sweepStaleDevices(NOW);
    expect(out).toEqual({ detected: 1, alerted: 0, failed: 0 });
    expect(createForUser).not.toHaveBeenCalled();
  });

  it('claims with the org in the guard so a cross-tenant write is impossible', async () => {
    const { service, displayDevice } = build({});
    await service.sweepStaleDevices(NOW);
    expect(displayDevice.updateMany).toHaveBeenCalledWith({
      where: { id: 'dev-1', organizationId: 'org-1', staleNotifiedAt: null },
      data: { staleNotifiedAt: NOW },
    });
  });

  it('resolves recipients from the org roles that actually grant device management', async () => {
    const { service, user } = build({});
    await service.sweepStaleDevices(NOW);
    const [args] = user.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toMatchObject({
      organizationId: 'org-1',
      status: 'ACTIVE',
      userRoles: { some: { role: { permissions: { has: 'display.devices.manage' } } } },
    });
  });

  it('does not notify anyone when the org has no device manager', async () => {
    const { service, createForUser } = build({ recipients: [] });
    const out = await service.sweepStaleDevices(NOW);
    expect(out).toEqual({ detected: 1, alerted: 1, failed: 0 });
    expect(createForUser).not.toHaveBeenCalled();
  });

  it('notifies every device manager, not just the first', async () => {
    const { service, createForUser } = build({
      recipients: [{ id: 'user-1' }, { id: 'user-2' }],
    });
    await service.sweepStaleDevices(NOW);
    expect(createForUser).toHaveBeenCalledTimes(2);
  });

  it('counts a failed notification without aborting the pass', async () => {
    // Isolation: one tenant that cannot be notified must not stop the sweep for
    // every other tenant (ADR-044).
    const { service } = build({ notifyThrows: true });
    const out = await service.sweepStaleDevices(NOW);
    expect(out).toEqual({ detected: 1, alerted: 0, failed: 1 });
  });

  it('counts a failed claim without aborting the pass', async () => {
    const { service } = build({ claimThrows: true });
    const out = await service.sweepStaleDevices(NOW);
    expect(out).toEqual({ detected: 1, alerted: 0, failed: 1 });
  });

  it('continues past one failing device and still alerts the rest', async () => {
    const displayDevice = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'dev-1', organizationId: 'org-1', branchId: 'b1', name: 'A', lastSeenAt: null },
        { id: 'dev-2', organizationId: 'org-2', branchId: 'b2', name: 'B', lastSeenAt: null },
      ]),
      updateMany: jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ count: 1 }),
    };
    const createForUser = jest.fn().mockResolvedValue({ id: 'n-1' });
    const service = new DisplayService(
      {
        unscoped: () => ({
          displayDevice,
          user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]) },
          branch: { findFirst: jest.fn().mockResolvedValue({ name: 'Main' }) },
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { createForUser } as never,
      {} as never,
    );
    const out = await service.sweepStaleDevices(NOW);
    expect(out).toEqual({ detected: 2, alerted: 1, failed: 1 });
  });

  it('reports nothing when no device is stale', async () => {
    const { service } = build({ candidates: [] });
    const out = await service.sweepStaleDevices(NOW);
    expect(out).toEqual({ detected: 0, alerted: 0, failed: 0 });
  });

  it('degrades to a generic branch label when the branch row is unreadable', async () => {
    const { service, createForUser } = build({ branchName: null });
    await service.sweepStaleDevices(NOW);
    const call = createForUser.mock.calls[0]?.[0] as { variables: Record<string, unknown> };
    expect(call.variables.branchName).toBe('its branch');
  });

  it('reports at least a whole minute for a device that has only just gone dark', async () => {
    const { createForUser } = build({});
    const justStale = new Date(NOW.getTime() - STALE_AFTER_MS - 1_000);
    const displayDevice = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'dev-1',
          organizationId: 'org-1',
          branchId: 'branch-1',
          name: 'Waiting Room A',
          lastSeenAt: justStale,
        },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const svc = new DisplayService(
      {
        unscoped: () => ({
          displayDevice,
          user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]) },
          branch: { findFirst: jest.fn().mockResolvedValue({ name: 'Main' }) },
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { createForUser } as never,
      {} as never,
    );
    await svc.sweepStaleDevices(NOW);
    const call = createForUser.mock.calls[0]?.[0] as { variables: Record<string, unknown> };
    // "0 minutes" would read as a bug to whoever gets paged.
    expect(call.variables.minutes).toBeGreaterThanOrEqual(1);
  });
});

/**
 * A sweep that alerts once and never re-arms is worse than no sweep: it tells an
 * operator their screen died, they fix nothing because the device is fine, and
 * the next real outage is silent. These assert the re-arm.
 */
describe('stale alerting re-arms', () => {
  it('clears the alert when the device checks in again', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'dev-1' });
    const service = new DisplayService(
      { unscoped: () => ({ displayDevice: { update } }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    // snapshot() is what a device calls on every poll, and it touches liveness.
    await (service as unknown as { touchDevice(id: string): Promise<unknown> }).touchDevice(
      'dev-1',
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dev-1' },
        data: expect.objectContaining({ staleNotifiedAt: null }),
      }),
    );
  });
});