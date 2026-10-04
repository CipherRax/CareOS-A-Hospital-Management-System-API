import { DisplayController } from '../../../src/modules/display/display.controller';
import { DisplayService } from '../../../src/modules/display/display.service';

function build() {
  const display = {
    snapshot: jest.fn(),
    isStillActive: jest.fn().mockResolvedValue(true),
  };
  const tenantContext = {
    scope: { device: { deviceId: 'dev-1', branchId: 'branch-1', departmentIds: ['dept-1'] } },
    requireOrg: () => 'org-1',
  };
  const realtime = {
    channel: jest.fn((org: string, topic: string) => `${org}:${topic}`),
    subscriber: jest.fn(),
  };
  const controller = new DisplayController(display as never, tenantContext as never, realtime as never);
  return { controller, display, realtime };
}

/** `forScopes` is private; reach it the way the stream handler does. */
function scopes(controller: DisplayController, raw: string, departmentIds: string[]): boolean {
  return (controller as unknown as { forScopes: (r: string, d: string[]) => boolean }).forScopes(
    raw,
    departmentIds,
  );
}

describe('DisplayController.forScopes — department scoping (ADR-023)', () => {
  it('shows an event for a department this device displays', () => {
    const { controller } = build();
    expect(
      scopes(controller, JSON.stringify({ payload: { departmentId: 'dept-1' } }), ['dept-1']),
    ).toBe(true);
  });

  it('hides an event for another department', () => {
    const { controller } = build();
    expect(
      scopes(controller, JSON.stringify({ payload: { departmentId: 'dept-2' } }), ['dept-1']),
    ).toBe(false);
  });

  it('hides an event that carries no department at all', () => {
    // The regression: a missing departmentId used to return true, so every event
    // on the queue channel was broadcast to every screen in the org.
    const { controller } = build();
    expect(scopes(controller, JSON.stringify({ payload: {} }), ['dept-1'])).toBe(false);
    expect(scopes(controller, JSON.stringify({ payload: { departmentId: null } }), ['dept-1'])).toBe(
      false,
    );
    expect(scopes(controller, JSON.stringify({}), ['dept-1'])).toBe(false);
    expect(scopes(controller, '{}', ['dept-1'])).toBe(false);
  });

  it('hides an event with an empty department string', () => {
    const { controller } = build();
    expect(scopes(controller, JSON.stringify({ payload: { departmentId: '' } }), ['dept-1'])).toBe(
      false,
    );
  });

  it('shows nothing at all when the device has no departments', () => {
    const { controller } = build();
    expect(scopes(controller, JSON.stringify({ payload: { departmentId: 'dept-1' } }), [])).toBe(false);
  });

  it('is an exact match, not a prefix or partial', () => {
    const { controller } = build();
    expect(scopes(controller, JSON.stringify({ payload: { departmentId: 'dept-1x' } }), ['dept-1'])).toBe(
      false,
    );
  });
});

describe('DisplayService.isStillActive — stream liveness', () => {
  function serviceWith(status: string | null) {
    const findFirst = jest.fn().mockResolvedValue(status === 'ACTIVE' ? { id: 'dev-1' } : null);
    const service = new DisplayService(
      { unscoped: () => ({ displayDevice: { findFirst } }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, findFirst };
  }

  it('reports an active device as still active', async () => {
    const { service } = serviceWith('ACTIVE');
    await expect(service.isStillActive('dev-1')).resolves.toBe(true);
  });

  it.each(['REVOKED', 'PENDING_PAIRING'])('reports a %s device as no longer active', async (status) => {
    const { service } = serviceWith(status);
    await expect(service.isStillActive('dev-1')).resolves.toBe(false);
  });

  it('queries by id AND active status so a revoked device cannot pass', async () => {
    const { service, findFirst } = serviceWith('REVOKED');
    await service.isStillActive('dev-1');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dev-1', status: 'ACTIVE' },
      }),
    );
  });

  it('fails closed when the database check itself errors', async () => {
    // A stream is not worth keeping open on an unprovable authorisation check.
    const findFirst = jest.fn().mockRejectedValue(new Error('db down'));
    const service = new DisplayService(
      { unscoped: () => ({ displayDevice: { findFirst } }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.isStillActive('dev-1')).resolves.toBe(false);
  });

  it('reports a device that does not exist as not active', async () => {
    const { service } = serviceWith(null);
    await expect(service.isStillActive('gone')).resolves.toBe(false);
  });
});