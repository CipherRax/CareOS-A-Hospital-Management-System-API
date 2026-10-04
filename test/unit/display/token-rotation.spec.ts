import { DisplayService } from '../../../src/modules/display/display.service';
import { hashSecret } from '../../../src/common/security/device-secret';
import { ErrorCodes } from '../../../src/common/errors/codes';

const ORG = 'org-1';
const DEVICE_ID = 'dev-1';

/**
 * Token rotation is a handover operation, not a silent background refresh: an
 * operator who triggers it must not strand a device, and a revoked device must not
 * stay reachable. These tests pin the digest bookkeeping that makes both true.
 */
function build(current: Record<string, unknown>) {
  const displayDevice = {
    findFirst: jest.fn().mockResolvedValue(current),
    update: jest.fn().mockImplementation(({ data }: { data: unknown }) => ({ ...current, ...(data as object) })),
  };
  const auditLog = { create: jest.fn().mockResolvedValue({ id: 'a-1' }) };
  const ctx = {
    db: { displayDevice, auditLog },
    emit: jest.fn(),
    organizationId: ORG,
  };
  const txRunner = { run: jest.fn(async (work: (c: unknown) => Promise<unknown>) => work(ctx)) };
  const realtime = { publish: jest.fn() };
  const tenantContext = { requireOrg: () => ORG };
  const redis = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({} as any),
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
  };
   
  const service = new DisplayService(
    { unscoped: () => ({ displayDevice }) } as never,
    tenantContext as never,
    txRunner as never,
    realtime as never,
    {} as never,
    redis as never,
  );
  return { service, displayDevice, auditLog, ctx };
}

const ACTIVE = {
  id: DEVICE_ID,
  organizationId: ORG,
  branchId: 'branch-1',
  departmentIds: ['dept-a'],
  name: 'Lobby screen',
  status: 'ACTIVE',
  tokenHash: hashSecret(`${ORG}.original`),
  tokenRotatedAt: null,
  previousTokenHash: null,
  previousTokenExpiresAt: null,
  lastSeenAt: new Date(),
  pairingExpiresAt: null,
  createdAt: new Date(),
};

describe('display token rotation overlap', () => {
  it('retains the outgoing digest with a bounded expiry', async () => {
    // Brief §5.16: the previous token keeps working through the handover.
    const { service, displayDevice } = build(ACTIVE);
    const before = Date.now();
    const result = await service.rotateToken(DEVICE_ID);

    const [args] = displayDevice.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.previousTokenHash).toBe(ACTIVE.tokenHash);
    const expiry = args.data.previousTokenExpiresAt as Date;
    expect(expiry.getTime()).toBeGreaterThan(before);
    // Bounded, not indefinite: the overlap must not become a second long-lived
    // credential.
    expect(expiry.getTime()).toBeLessThanOrEqual(before + 10 * 60_000 + 1_000);
    // The new token is issued and is not the one being retired.
    expect(result.accessToken).toContain(ORG);
    expect(args.data.tokenHash).not.toBe(ACTIVE.tokenHash);
  });

  it('does not return the outgoing token again', async () => {
    const { service } = build(ACTIVE);
    const result = await service.rotateToken(DEVICE_ID);
    expect(result.accessToken).not.toContain(hashSecret(result.accessToken));
  });

  it('rejects a rotation on a device that is not ACTIVE', async () => {
    const { service, displayDevice } = build({ ...ACTIVE, status: 'PENDING_PAIRING' });
    await expect(service.rotateToken(DEVICE_ID)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
    });
    expect(displayDevice.update).not.toHaveBeenCalled();
  });

  it('blocks a second rotation inside the cooldown', async () => {
    // Rotation hands out the new token once; a rapid second rotation would
    // invalidate the token the first operator was just given.
    const { service, displayDevice } = build({ ...ACTIVE, tokenRotatedAt: new Date() });
    await expect(service.rotateToken(DEVICE_ID)).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
    });
    expect(displayDevice.update).not.toHaveBeenCalled();
  });

  it('clears both digests on revoke', async () => {
    // A revoked device must not stay reachable through the overlap token.
    const { service, displayDevice } = build({
      ...ACTIVE,
      previousTokenHash: hashSecret(`${ORG}.older`),
      previousTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    await service.revoke(DEVICE_ID);
    const [args] = displayDevice.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data).toMatchObject({
      status: 'REVOKED',
      tokenHash: null,
      previousTokenHash: null,
      previousTokenExpiresAt: null,
    });
  });

  it('clears the overlap digest when a device is re-paired', async () => {
    // An overlap window must not carry an old token across a full re-pair.
    const { service, displayDevice } = build({
      ...ACTIVE,
      previousTokenHash: hashSecret(`${ORG}.older`),
      previousTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    await service.rescan(DEVICE_ID);
    const [args] = displayDevice.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data).toMatchObject({
      status: 'PENDING_PAIRING',
      previousTokenHash: null,
      previousTokenExpiresAt: null,
    });
  });
});