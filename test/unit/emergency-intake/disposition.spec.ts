import { FieldEncryption } from '../../../src/common/security/crypto';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { EmergencyIntakeService } from '../../../src/modules/emergency-intake/emergency-intake.service';

const SECRET = 'unit-test-key-encryption-secret-0123456789abcdef';

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    status: 'RECEIVED',
    escalationLevel: 0,
    dispositionAt: null,
    closedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function build(current: Record<string, unknown>, target?: Record<string, unknown>) {
  const update = jest.fn().mockImplementation((args: { data: unknown }) => ({
    ...current,
    ...(args?.data as object),
  }));
  const txDb: Record<string, unknown> = {
    emergencyRequest: { findFirst: jest.fn().mockResolvedValue(current), findFirstOrThrow: jest.fn().mockResolvedValue(current), update },
    emergencyRequestEvent: { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) },
    emergencyVisit: { findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'a-1' }) },
    // The merge path reads the canonical request as well as the source one.
    requests: { findFirst: jest.fn().mockResolvedValue(current) },
  };
  const txContext = { db: txDb, emit: jest.fn() };
  const byId: Record<string, unknown> = { 'req-1': current };
  if (target) byId[target.id as string] = target;
  (txDb.emergencyRequest as { findFirst: jest.Mock }).findFirst.mockImplementation(
    ({ where }: { where: { id: string } }) => Promise.resolve(byId[where.id] ?? null),
  );

  const service = new EmergencyIntakeService(
    { unscoped: () => ({}), tenantFor: () => ({}) } as never,
    { scope: {}, requireOrg: () => 'org-1', requireUserId: () => 'user-1' } as never,
    { run: jest.fn(async (work: (c: unknown) => Promise<unknown>) => work(txContext)) } as never,
    { publish: jest.fn() } as never,
    new FieldEncryption(SECRET),
    { add: jest.fn() } as never,
    { EMERGENCY_DEDUPE_SECONDS: 120, EMERGENCY_RETENTION_DAYS: 90 } as never,
  );
  return { service, update, txContext };
}

/** The data actually written for the source request. */
function writeFor(update: jest.Mock, index = 0) {
  const calls = update.mock.calls as Array<[{ where: { id: string }; data: Record<string, unknown> }]>;
  const call = calls[index];
  if (!call) throw new Error(`no update call at index ${index} (total ${calls.length})`);
  return call[0]?.data;
}

describe('disposition timestamps (ADR-055)', () => {
  // These four are finished for the facility but are not "closed". Without a
  // retention timestamp they kept encrypted caller PII indefinitely.
  describe.each(['UNREACHABLE', 'REDIRECTED', 'NOT_ACTIONABLE'] as const)(
    'setRequestStatus → %s',
    (status) => {
      it('starts the retention clock', async () => {
        const { service, update } = build(request());
        await service.setRequestStatus('req-1', { status, reason: 'Not reachable.' } as never);
        expect(writeFor(update).dispositionAt).toBeInstanceOf(Date);
      });

      it('does not claim the request was closed', async () => {
        // closedAt is reported to staff as a close stamp. A redirected caller is
        // finished, but staff did not close this request, so conflating the two
        // would misreport the record.
        const { service, update } = build(request());
        await service.setRequestStatus('req-1', { status, reason: 'Not reachable.' } as never);
        expect(writeFor(update).closedAt).toBeUndefined();
      });

      it('preserves a disposition stamped by an earlier step', async () => {
        // Re-marking must not restart the clock, or the retention window would
        // never be reached for a request staff keep re-triaging.
        const earlier = new Date('2026-01-01T00:00:00.000Z');
        const { service, update } = build(request({ dispositionAt: earlier }));
        await service.setRequestStatus('req-1', { status, reason: 'Still nothing.' } as never);
        expect(writeFor(update).dispositionAt).toEqual(earlier);
      });
    },
  );

  it('still requires a reason for redirected and not-actionable', async () => {
    // The reason is what the caller is shown, so it cannot be optional.
    const { service, update } = build(request());
    await expect(service.setRequestStatus('req-1', { status: 'REDIRECTED' } as never)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('allows an unreachable marking with no reason', async () => {
    const { service, update } = build(request());
    await service.setRequestStatus('req-1', { status: 'UNREACHABLE' } as never);
    expect(writeFor(update).status).toBe('UNREACHABLE');
  });

  it('starts the clock when a duplicate is merged', async () => {
    // A merged duplicate keeps the caller's encrypted PII on the source row.
    const source = request({ id: 'req-1', status: 'RECEIVED' });
    const { service, update } = build(source, request({ id: 'req-2', status: 'ACKNOWLEDGED' }));
    await service.mergeRequest('req-1', { intoRequestId: 'req-2' } as never);
    expect(writeFor(update).dispositionAt).toBeInstanceOf(Date);
    expect(writeFor(update).status).toBe('DUPLICATE');
  });

  it('refuses to merge a request into another branch', async () => {
    // Merging across branches would fold one facility's request into another's
    // record, so the row is left untouched.
    const source = request({ id: 'req-1', branchId: 'branch-1' });
    const { service, update } = build(source, request({ id: 'req-2', branchId: 'branch-2' }));
    await expect(
      service.mergeRequest('req-1', { intoRequestId: 'req-2' } as never),
    ).rejects.toMatchObject({ code: ErrorCodes.EMERGENCY_INVALID_TRANSITION });
    expect(update).not.toHaveBeenCalled();
  });
});