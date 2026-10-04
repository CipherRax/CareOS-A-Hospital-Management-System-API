import { FieldEncryption } from '../../../src/common/security/crypto';
import { EventTypes } from '../../../src/events/catalog';
import { EmergencyIntakeService } from '../../../src/modules/emergency-intake/emergency-intake.service';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const LEVEL_SECONDS = [120, 300, 900];

function build(args: {
  levelSeconds?: number[];
  enabled?: boolean;
  autoEscalate?: boolean;
  request?: Record<string, unknown> | null;
  updateCount?: number;
}) {
  const request = args.request === undefined ? null : args.request;
  const emergencyRequest = {
    findFirst: jest.fn().mockResolvedValue(request),
    updateMany: jest.fn().mockResolvedValue({ count: args.updateCount ?? 1 }),
  };
  const emergencyIntakePolicy = {
    findFirst: jest.fn().mockResolvedValue({
      enabled: args.enabled ?? true,
      autoEscalate: args.autoEscalate ?? true,
      levelSeconds: args.levelSeconds ?? LEVEL_SECONDS,
    }),
  };
  const emergencyRequestEvent = { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) };
  const auditLog = { create: jest.fn().mockResolvedValue({ id: 'a-1' }) };
  const tenant = { emergencyRequest, emergencyIntakePolicy };
  const prisma = { unscoped: () => ({}), tenantFor: jest.fn(() => tenant) };

  const tenantContext = {
    scope: {},
    requireOrg: jest.fn(() => 'org-1'),
    requireUserId: jest.fn(() => 'user-1'),
  };
  const realtime = { publish: jest.fn() };
  const queue = { add: jest.fn() };
  const txContext: { db: Record<string, unknown>; emit: (e: unknown) => void } = {
    db: { emergencyRequestEvent, auditLog },
    emit: jest.fn(),
  };
  const txRun = jest.fn(async (work: (ctx: unknown) => Promise<unknown>) => work(txContext));
  const service = new EmergencyIntakeService(
    prisma as never,
    tenantContext as never,
    { run: txRun } as never,
    realtime as never,
    new FieldEncryption(SECRET),
    queue as never,
    { EMERGENCY_DEDUPE_SECONDS: 120, EMERGENCY_RETENTION_DAYS: 90 } as never,
  );
  return { service, emergencyRequest, emergencyRequestEvent, auditLog, queue, realtime, txContext, tenant };
}

const OPEN = { id: 'req-1', status: 'RECEIVED', branchId: 'branch-1', escalationLevel: 0 };

describe('EmergencyIntakeService.attemptEscalation', () => {
  describe('exactly-once progression', () => {
    it('advances to the next level and records it', async () => {
      const { service, emergencyRequest, emergencyRequestEvent, auditLog, queue } = build({
        request: OPEN,
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('advanced');

      expect(emergencyRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'req-1', escalationLevel: 0 }),
          data: { escalationLevel: 1, status: 'ESCALATED' },
        }),
      );
      expect(emergencyRequestEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'ESCALATED', level: 1 }) }),
      );
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'emergency_request.escalated_level_1' }),
        }),
      );
      // Next level booked at the policy's delay.
      expect(queue.add).toHaveBeenCalledWith(
        'escalate',
        expect.objectContaining({ requestId: 'req-1', level: 2 }),
        expect.objectContaining({ jobId: 'req-1-2', delay: 300_000 }),
      );
    });

    it('does nothing when the level was already reached', async () => {
      // BullMQ redelivery: a retried job for a level we already passed.
      const { service, emergencyRequest, queue, txContext } = build({
        request: { ...OPEN, escalationLevel: 1, status: 'ESCALATED' },
        updateCount: 0,
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(txContext.emit).not.toHaveBeenCalled();
    });

    it('does nothing when it loses the guarded race', async () => {
      // Two workers fired the same level; one wins the updateMany.
      const { service, emergencyRequestEvent, txContext } = build({
        request: OPEN,
        updateCount: 0,
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('noop');
      expect(emergencyRequestEvent.create).not.toHaveBeenCalled();
      expect(txContext.emit).not.toHaveBeenCalled();
    });

    it('advances an ESCALATED request to the following level', async () => {
      const { service, queue } = build({
        request: { ...OPEN, escalationLevel: 1, status: 'ESCALATED' },
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 2)).resolves.toBe('advanced');
      expect(queue.add).toHaveBeenCalledWith(
        'escalate',
        expect.objectContaining({ level: 3 }),
        expect.anything(),
      );
    });

    it('refuses a level beyond the policy chain', async () => {
      const { service, emergencyRequest } = build({
        request: { ...OPEN, escalationLevel: 3, status: 'ESCALATED' },
        levelSeconds: LEVEL_SECONDS,
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 4)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('the chain stops when a human has engaged', () => {
    it.each([
      ['ACKNOWLEDGED'],
      ['CONTACTED'],
      ['RESPONDING'],
      ['UNREACHABLE'],
      ['NOT_ACTIONABLE'],
      ['REDIRECTED'],
      ['DUPLICATE'],
      ['CLOSED'],
      ['CANCELLED'],
    ])('does not escalate a %s request', async (status) => {
      const { service, emergencyRequest, queue } = build({
        request: { ...OPEN, status, escalationLevel: 1 },
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 2)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does not resurrect a request that is already closed', async () => {
      const { service, emergencyRequest } = build({
        request: { ...OPEN, status: 'CLOSED', escalationLevel: 0 },
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('policy gates', () => {
    it('does nothing when the policy is disabled', async () => {
      const { service, emergencyRequest } = build({ request: OPEN, enabled: false });
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing when auto-escalate is switched off mid-flight', async () => {
      // An operator turning auto-escalate off must actually stop the chain.
      const { service, emergencyRequest, queue } = build({ request: OPEN, autoEscalate: false });
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does nothing when the policy row is gone', async () => {
      const { service, emergencyRequest, tenant } = build({ request: OPEN });
      tenant.emergencyIntakePolicy.findFirst.mockResolvedValue(null);
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing for an unknown request', async () => {
      const { service, emergencyRequest } = build({ request: null });
      await expect(service.attemptEscalation('req-missing', 'org-1', 1)).resolves.toBe('noop');
      expect(emergencyRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('final level', () => {
    it('emits only the final event, not both escalation and final', async () => {
      // Two events for one transition would page the on-call chain twice and
      // log the caller nudge twice.
      const { service, txContext, queue } = build({
        request: { ...OPEN, escalationLevel: 2, status: 'ESCALATED' },
        levelSeconds: LEVEL_SECONDS,
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 3)).resolves.toBe('advanced');

      const emitted = (txContext.emit as jest.Mock).mock.calls.map((c) => c[0].type);
      expect(emitted).toEqual([EventTypes.EmergencyRequestFinalEscalation]);
      expect(emitted).not.toContain(EventTypes.EmergencyRequestEscalated);
      // And no level 4 is booked: the chain is exhausted.
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('marks the final event record as final', async () => {
      const { service, emergencyRequestEvent } = build({
        request: { ...OPEN, escalationLevel: 2, status: 'ESCALATED' },
      });
      await service.attemptEscalation('req-1', 'org-1', 3);
      expect(emergencyRequestEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payload: { level: 3, final: true } }),
        }),
      );
    });

    it('writes a distinct audit action for the final level', async () => {
      const { service, auditLog } = build({
        request: { ...OPEN, escalationLevel: 2, status: 'ESCALATED' },
      });
      await service.attemptEscalation('req-1', 'org-1', 3);
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'emergency_request.final_escalation' }),
        }),
      );
    });

    it('publishes the final event to the inbox realtime topic', async () => {
      const { service, realtime } = build({
        request: { ...OPEN, escalationLevel: 2, status: 'ESCALATED' },
      });
      await service.attemptEscalation('req-1', 'org-1', 3);
      expect(realtime.publish).toHaveBeenCalledWith(
        'org-1',
        'emergency-requests',
        expect.objectContaining({ event: EventTypes.EmergencyRequestFinalEscalation }),
      );
    });

    it('publishes a non-final escalation to the inbox too', async () => {
      // Otherwise the inbox shows a stale escalation level until a manual refresh.
      const { service, realtime } = build({ request: OPEN });
      await service.attemptEscalation('req-1', 'org-1', 1);
      expect(realtime.publish).toHaveBeenCalledWith(
        'org-1',
        'emergency-requests',
        expect.objectContaining({ event: EventTypes.EmergencyRequestEscalated }),
      );
    });

    it('emits no caller PHI in the escalation event payload', async () => {
      const { service, txContext } = build({ request: OPEN });
      await service.attemptEscalation('req-1', 'org-1', 1);
      const payload = (txContext.emit as jest.Mock).mock.calls[0][0].payload;
      expect(payload).toEqual({ requestId: 'req-1', level: 1 });
    });
  });

  describe('single-level policy', () => {
    it('treats the only level as final', async () => {
      const { service, txContext, queue } = build({
        request: OPEN,
        levelSeconds: [120],
      });
      await expect(service.attemptEscalation('req-1', 'org-1', 1)).resolves.toBe('advanced');
      expect((txContext.emit as jest.Mock).mock.calls[0][0].type).toBe(
        EventTypes.EmergencyRequestFinalEscalation,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});