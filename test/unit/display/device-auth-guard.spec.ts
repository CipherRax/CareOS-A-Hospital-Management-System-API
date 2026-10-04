import type { ExecutionContext } from '@nestjs/common';
import { DeviceAuthGuard } from '../../../src/common/guards/device-auth.guard';
import { ErrorCodes } from '../../../src/common/errors/codes';

const ORG = 'org-1';
const DEVICE_ID = 'dev-1';

/**
 * The guard is the only thing standing between a stolen device token and a public
 * waiting-room board, so these tests pin down exactly when a token authenticates.
 * Digest matching is stubbed because hashing is deterministic per token string:
 * `hashSecret` is replaced with a pass-through so the token text is readable in
 * the assertions.
 */
function build(options: {
  tokenHash?: string | null;
  previousTokenHash?: string | null;
  previousTokenExpiresAt?: Date | null;
  status?: string;
  lookupThrows?: boolean;
}) {
  const device = {
    id: DEVICE_ID,
    organizationId: ORG,
    branchId: 'branch-1',
    departmentIds: ['dept-a'],
    status: options.status ?? 'ACTIVE',
    tokenHash: options.tokenHash ?? null,
    previousTokenExpiresAt: options.previousTokenExpiresAt ?? null,
  };
  const displayDevice = {
    findFirst: jest.fn().mockResolvedValue(device),
  };
  const scoped = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    displayDevice,
  };
  // Prisma's array-form transaction resolves to an array of results in query
  // order; the guard reads results[1] for the device lookup.
  const transactional = {
    ...scoped,
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  const prisma = { tenantFor: jest.fn(() => transactional) };
  const scope: unknown[] = [];
  const tenantContext = { setScope: jest.fn((s: unknown) => scope.push(s)) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guard = new DeviceAuthGuard(prisma as any, tenantContext as any);
  return { guard, displayDevice, tenantContext, scope, device, token: `${ORG}.secret-token` };
}

function contextFor(token: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
    }),
  } as unknown as ExecutionContext;
}

describe('DeviceAuthGuard token overlap window', () => {
   
  const secret = jest.requireActual('../../../src/common/security/device-secret') as {
    hashSecret: (v: string) => string;
  };

  it('accepts the current token', async () => {
    const token = `${ORG}.current-token`;
    const digest = secret.hashSecret(token);
    const b = build({ tokenHash: digest });
    await expect(b.guard.canActivate(contextFor(token))).resolves.toBe(true);
  });

  it('accepts the outgoing token inside the overlap window', async () => {
    // Brief §5.16: rotation is not instantaneous for a device, so the previous
    // token must keep working for a bounded window after rotation.
    const oldToken = `${ORG}.old-token`;
    const digest = secret.hashSecret(oldToken);
    const b = build({
      tokenHash: secret.hashSecret(`${ORG}.new-token`),
      previousTokenHash: digest,
      previousTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(b.guard.canActivate(contextFor(oldToken))).resolves.toBe(true);
    // Scope is still only the device's own branch/departments.
    expect(b.tenantContext.setScope).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: ['queue.display'],
        device: { deviceId: DEVICE_ID, branchId: 'branch-1', departmentIds: ['dept-a'] },
      }),
    );
  });

  it('rejects the outgoing token once the overlap window has closed', async () => {
    const oldToken = `${ORG}.old-token`;
    const digest = secret.hashSecret(oldToken);
    const b = build({
      tokenHash: secret.hashSecret(`${ORG}.new-token`),
      previousTokenHash: digest,
      previousTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    // An un-cleaned row must not be able to extend a token's life past its window.
    await expect(b.guard.canActivate(contextFor(oldToken))).rejects.toMatchObject({
      code: ErrorCodes.DEVICE_TOKEN_INVALID,
    });
    expect(b.tenantContext.setScope).not.toHaveBeenCalled();
  });

  it('rejects the outgoing token when no window was ever set', async () => {
    const oldToken = `${ORG}.old-token`;
    const b = build({
      tokenHash: secret.hashSecret(`${ORG}.new-token`),
      previousTokenHash: secret.hashSecret(oldToken),
      previousTokenExpiresAt: null,
    });
    await expect(b.guard.canActivate(contextFor(oldToken))).rejects.toMatchObject({
      code: ErrorCodes.DEVICE_TOKEN_INVALID,
    });
  });

  it('rejects a revoked device even on a token inside the overlap window', async () => {
    // Revocation clears both digests, and status is checked regardless, so a
    // half-cleaned row still cannot reach the board.
    const token = `${ORG}.token`;
    const b = build({
      tokenHash: secret.hashSecret(token),
      status: 'REVOKED',
    });
    await expect(b.guard.canActivate(contextFor(token))).rejects.toMatchObject({
      code: ErrorCodes.DEVICE_REVOKED,
    });
    expect(b.tenantContext.setScope).not.toHaveBeenCalled();
  });

  it('queries both the current and overlap digests', async () => {
    const token = `${ORG}.token`;
    const b = build({ tokenHash: secret.hashSecret(token) });
    await b.guard.canActivate(contextFor(token));
    const [args] = b.displayDevice.findFirst.mock.calls[0];
    expect(args.where.OR).toHaveLength(2);
  });

  it('rejects a token that matches nothing', async () => {
    const b = build({ tokenHash: secret.hashSecret(`${ORG}.different`) });
    await expect(b.guard.canActivate(contextFor(`${ORG}.token`))).rejects.toMatchObject({
      code: ErrorCodes.DEVICE_TOKEN_INVALID,
    });
  });

  it('rejects a malformed token without a query', async () => {
    const b = build({ tokenHash: null });
    await expect(b.guard.canActivate(contextFor('no-organization-prefix'))).rejects.toMatchObject({
      code: ErrorCodes.DEVICE_TOKEN_INVALID,
    });
    expect(b.displayDevice.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    const b = build({ tokenHash: null });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;
    await expect(b.guard.canActivate(ctx)).rejects.toMatchObject({
      code: ErrorCodes.DEVICE_TOKEN_INVALID,
    });
  });
});