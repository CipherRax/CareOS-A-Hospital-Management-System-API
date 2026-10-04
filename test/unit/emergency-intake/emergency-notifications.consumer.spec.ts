import { EventTypes } from '../../../src/events/catalog';
import { EmergencyNotificationConsumer } from '../../../src/modules/emergency-intake/emergency-notifications.consumer';

const REQUEST = {
  id: 'req-1',
  referenceNumber: 'EMR-2026-000001',
  branchId: 'branch-1',
  escalationLevel: 3,
  status: 'ESCALATED',
  acknowledgedAt: null,
  respondedAt: null,
  flagged: false,
};

function build(args: { contacts?: unknown[]; template?: unknown } = {}) {
  const emergencyRequest = {
    findFirst: jest.fn().mockResolvedValue(REQUEST),
  };
  const emergencyContact = {
    findMany: jest.fn().mockResolvedValue(
      args.contacts ?? [{ id: 'c-1', name: 'On-call', role: 'NURSE', userId: 'user-1', phone: '+254700000000', order: 0 }],
    ),
  };
  const emergencyIntakePolicy = {
    findFirst: jest.fn().mockResolvedValue({ levelSeconds: [120, 300, 900], emergencyPhone: '+254202555100' }),
  };
  const branch = { findFirst: jest.fn().mockResolvedValue({ name: 'St Matthews', phone: '+254202555200' }) };
  const tenant = { emergencyRequest, emergencyContact, emergencyIntakePolicy, branch };
  const prisma = { tenantFor: jest.fn(() => tenant) };
  const createForUser = jest.fn().mockResolvedValue({ id: 'n-1' });
  const notifications = { createForUser };
  const consumer = new EmergencyNotificationConsumer(prisma as never, notifications as never);
  const warn = jest.spyOn(consumer['logger'], 'warn').mockImplementation(() => undefined);
  const log = jest.spyOn(consumer['logger'], 'log').mockImplementation(() => undefined);
  return { consumer, createForUser, emergencyRequest, emergencyContact, emergencyIntakePolicy, warn, log };
}

function ctx(type: string, payload: Record<string, unknown> = {}) {
  return { row: { id: 'ob-1', type, payload }, organizationId: 'org-1' } as never;
}

describe('EmergencyNotificationConsumer', () => {
  describe('on-call paging', () => {
    it('pages every on-call contact for a received request', async () => {
      const { consumer, createForUser } = build({
        contacts: [
          { id: 'c-1', name: 'A', role: 'NURSE', userId: 'user-1', phone: null, order: 0 },
          { id: 'c-2', name: 'B', role: 'DOCTOR', userId: 'user-2', phone: null, order: 1 },
        ],
      });
      await consumer.handle(ctx(EventTypes.EmergencyRequestReceived, { requestId: 'req-1' }));
      expect(createForUser).toHaveBeenCalledTimes(2);
    });

    it('uses the received template, not an "escalated to level 0" one', async () => {
      // Level 0 is not an escalation; rendering it as one tells on-call staff
      // something untrue when they are simply being told a request arrived.
      const { consumer, createForUser } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestReceived, { requestId: 'req-1' }));
      expect(createForUser).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'emergency.request_received' }),
      );
      const vars = createForUser.mock.calls[0][0].variables;
      expect(vars.level).toBeUndefined();
    });

    it('only pages contacts who are active and on call', async () => {
      // Off-shift staff must never be woken for an emergency.
      const { consumer, emergencyContact } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestReceived, { requestId: 'req-1' }));
      expect(emergencyContact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true, onCall: true }),
        }),
      );
    });

    it('records the gap for a phone-only contact instead of paging nobody silently', async () => {
      const { consumer, createForUser, warn } = build({
        contacts: [{ id: 'c-1', name: 'A', role: 'NURSE', userId: null, phone: '+254700000000', order: 0 }],
      });
      await consumer.handle(ctx(EventTypes.EmergencyRequestReceived, { requestId: 'req-1' }));
      expect(createForUser).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('no staff user'),
        expect.objectContaining({ contactId: 'c-1' }),
      );
    });
  });

  describe('PHI containment', () => {
    it('never renders caller identity, phone, location or description', async () => {
      const { consumer, createForUser } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestReceived, { requestId: 'req-1' }));
      const serialized = JSON.stringify(createForUser.mock.calls);
      // The only request data allowed in a notification is the reference.
      expect(serialized).toContain('EMR-2026-000001');
      expect(serialized).not.toContain('callerPhone');
      expect(serialized).not.toContain('location');
      expect(serialized).not.toContain('description');
    });

    it('does not read encrypted caller fields out of the database at all', async () => {
      // Defence in depth: even if a template were customised later, the consumer
      // has no caller PII in hand to render.
      const { consumer, emergencyRequest } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestReceived, { requestId: 'req-1' }));
      const select = emergencyRequest.findFirst.mock.calls[0][0].select;
      expect(Object.keys(select)).not.toContain('callerPhoneEnc');
      expect(Object.keys(select)).not.toContain('callerNameEnc');
      expect(Object.keys(select)).not.toContain('descriptionEnc');
    });

    it('logs no caller phone on the final escalation line', async () => {
      const { consumer, warn } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestFinalEscalation, { requestId: 'req-1', level: 3 }));
      const serialized = JSON.stringify(warn.mock.calls);
      expect(serialized).not.toContain('700000000');
      expect(serialized).not.toContain('callerPhone');
    });
  });

  describe('finality is carried by the event, not recomputed', () => {
    it('pages the non-final template for a plain escalation', async () => {
      const { consumer, createForUser } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestEscalated, { requestId: 'req-1', level: 2 }));
      expect(createForUser).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'emergency.escalation' }),
      );
    });

    it('pages the final template for the final escalation event', async () => {
      const { consumer, createForUser } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestFinalEscalation, { requestId: 'req-1', level: 3 }));
      expect(createForUser).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'emergency.final_escalation' }),
      );
    });

    it('does not re-derive finality from the policy chain on a plain escalation', async () => {
      // Policy may be edited after the level was scheduled, so the emitted event
      // is the authority on whether this level was the last.
      const { consumer, emergencyIntakePolicy } = build();
      emergencyIntakePolicy.findFirst.mockImplementation(() => {
        throw new Error('finality must not be re-derived from policy JSON');
      });
      await expect(
        consumer.handle(ctx(EventTypes.EmergencyRequestEscalated, { requestId: 'req-1', level: 1 })),
      ).resolves.toBeUndefined();
      expect(emergencyIntakePolicy.findFirst).not.toHaveBeenCalled();
    });

    it('tells the caller to phone on the final escalation', async () => {
      const { consumer, warn } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestFinalEscalation, { requestId: 'req-1', level: 3 }));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ callerAction: 'CALL_NOW' }),
        expect.stringContaining('call now'),
      );
    });
  });

  describe('idempotency across retries', () => {
    it('derives a stable notification id per level and contact', async () => {
      const { consumer, createForUser } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestEscalated, { requestId: 'req-1', level: 2 }));
      const id = createForUser.mock.calls[0][0].id;
      // createForUser upserts on id, so a redelivered event is a no-op.
      expect(id).toContain('req-1');
      expect(id).toContain('c-1');

      createForUser.mockClear();
      await consumer.handle(ctx(EventTypes.EmergencyRequestEscalated, { requestId: 'req-1', level: 2 }));
      expect(createForUser.mock.calls[0][0].id).toBe(id);
    });

    it('does not collide across levels or contacts', async () => {
      const { consumer, createForUser } = build({
        contacts: [
          { id: 'c-1', name: 'A', role: 'NURSE', userId: 'user-1', phone: null, order: 0 },
          { id: 'c-2', name: 'B', role: 'DOCTOR', userId: 'user-2', phone: null, order: 1 },
        ],
      });
      await consumer.handle(ctx(EventTypes.EmergencyRequestEscalated, { requestId: 'req-1', level: 1 }));
      await consumer.handle(ctx(EventTypes.EmergencyRequestEscalated, { requestId: 'req-1', level: 2 }));
      const ids = createForUser.mock.calls.map((c) => c[0].id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('ignores a payload with no request id', async () => {
      const { consumer, createForUser } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestReceived, {}));
      expect(createForUser).not.toHaveBeenCalled();
    });
  });

  describe('callback handling', () => {
    it('pages on-call when a callback attempt failed to reach the caller', async () => {
      const { consumer, createForUser, emergencyRequest } = build();
      emergencyRequest.findFirst.mockResolvedValue({ ...REQUEST, flagged: true });
      await consumer.handle(ctx(EventTypes.EmergencyRequestCallback, { requestId: 'req-1' }));
      expect(createForUser).toHaveBeenCalledWith(
        expect.objectContaining({ templateKey: 'emergency.request_unreachable' }),
      );
    });

    it('does not re-page for a successful callback', async () => {
      const { consumer, createForUser } = build();
      await consumer.handle(ctx(EventTypes.EmergencyRequestCallback, { requestId: 'req-1' }));
      expect(createForUser).not.toHaveBeenCalled();
    });
  });
});