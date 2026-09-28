import { EventTypes } from '../../../src/events/catalog';
import type { OutboxConsumerContext } from '../../../src/events/outbox-consumer/outbox-consumer.types';
import { PERMISSION_GROUPS } from '../../../src/common/auth/permissions.catalog';
import type { Notification } from '@prisma/client';
import {
  CodingReferenceConsumer,
  codingImportNotificationId,
} from '../../../src/modules/coding/coding.consumer';
import type { NotificationService } from '../../../src/modules/notifications/notifications.service';
import type { NotificationDeliveryService } from '../../../src/modules/notifications/notifications-delivery.service';

function notificationRow(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    organizationId: 'org-1',
    recipientUserId: 'user-1',
    recipientPatientId: null,
    channel: 'IN_APP',
    templateKey: 'coding.reference_updated',
    subject: 's',
    body: 'b',
    variables: {},
    status: 'PENDING',
    attemptCount: 0,
    errorCode: null,
    providerRef: null,
    nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
    readAt: null,
    sentAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeConsumer(userIds: string[] = ['admin-1']) {
  const createForUser = jest.fn(
    async (input: { id: string; variables: Record<string, string> }) =>
      notificationRow({ id: input.id, variables: input.variables }),
  );
  const send = jest.fn(async (row: Notification) => row);
  const findMany = jest.fn().mockResolvedValue(userIds.map((userId) => ({ userId })));
  const notifications = { createForUser } as unknown as NotificationService;
  const delivery = { send } as unknown as NotificationDeliveryService;
  const consumer = new CodingReferenceConsumer(notifications, delivery);
  return { consumer, createForUser, send, findMany };
}

function makeContext(
  payload: Record<string, unknown>,
  findMany: jest.Mock,
  overrides: Partial<OutboxConsumerContext['row']> = {},
): OutboxConsumerContext {
  return {
    row: {
      id: 'event-1',
      organizationId: 'org-1',
      type: EventTypes.CodingSystemImported,
      version: 1,
      aggregateType: 'coding_system',
      aggregateId: 'sys-1',
      actorId: 'admin-1',
      correlationId: null,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      payload,
      attemptCount: 0,
      ...overrides,
    },
    db: { userRole: { findMany } } as unknown as OutboxConsumerContext['db'],
    organizationId: 'org-1',
  } as unknown as OutboxConsumerContext;
}

describe('CodingReferenceConsumer', () => {
  it('is a stable, named consumer for the coding import event', () => {
    const { consumer } = makeConsumer();
    expect(consumer.name).toBe('coding-reference');
    expect(consumer.eventTypes).toEqual([EventTypes.CodingSystemImported]);
  });

  it('fans out a PHI-neutral notification to every coding.manage holder', async () => {
    const { consumer, createForUser, send, findMany } = makeConsumer(['admin-1', 'admin-2']);

    await consumer.handle(makeContext({ codingSystemId: 'sys-1', inserted: 4, total: 9 }, findMany));

    expect(createForUser).toHaveBeenCalledTimes(2);
    expect(createForUser.mock.calls[0]![0]).toMatchObject({
      id: 'notif-event-1-coding-admin-1',
      userId: 'admin-1',
      channel: 'IN_APP',
      templateKey: 'coding.reference_updated',
      organizationId: 'org-1',
      variables: { codingSystemId: 'sys-1', inserted: '4', total: '9' },
    });
    expect(createForUser.mock.calls[1]![0]).toMatchObject({ userId: 'admin-2' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('selects only active users whose roles hold coding.manage', async () => {
    const { consumer, findMany } = makeConsumer();
    const context = makeContext({ codingSystemId: 'sys-1', inserted: 1, total: 1 }, findMany);

    await consumer.handle(context);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        organizationId: 'org-1',
        role: { permissions: { has: PERMISSION_GROUPS.codings.manage } },
        user: { status: 'ACTIVE' },
      },
      distinct: ['userId'],
    });
  });

  it('derives a deterministic id so a replay cannot double-notify', async () => {
    const { consumer, createForUser, findMany } = makeConsumer(['admin-1']);
    const context = makeContext({ codingSystemId: 'sys-1', inserted: 1, total: 1 }, findMany);

    await consumer.handle(context);
    await consumer.handle(context);

    expect(codingImportNotificationId('event-1', 'admin-1')).toBe('notif-event-1-coding-admin-1');
    const ids = createForUser.mock.calls.map((call) => call[0].id);
    expect(new Set(ids).size).toBe(1);
  });

  it('falls back to the aggregate id when the payload omits codingSystemId', async () => {
    const { consumer, createForUser, findMany } = makeConsumer();

    await consumer.handle(makeContext({ inserted: 2, total: 2 }, findMany));

    expect(createForUser.mock.calls[0]![0].variables).toMatchObject({ codingSystemId: 'sys-1' });
  });

  it('does nothing when the event identifies no coding system at all', async () => {
    const { consumer, createForUser, send, findMany } = makeConsumer();

    await consumer.handle(makeContext({}, findMany, { aggregateId: '' }));

    expect(findMany).not.toHaveBeenCalled();
    expect(createForUser).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when no role in the org holds coding.manage', async () => {
    const { consumer, createForUser, send, findMany } = makeConsumer([]);

    await consumer.handle(makeContext({ codingSystemId: 'sys-1', inserted: 1, total: 1 }, findMany));

    expect(createForUser).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('coerces a missing or non-numeric count to 0 rather than rendering NaN', async () => {
    const { consumer, createForUser, findMany } = makeConsumer();

    await consumer.handle(makeContext({ codingSystemId: 'sys-1' }, findMany));
    await consumer.handle(
      makeContext({ codingSystemId: 'sys-1', inserted: 'x', total: null }, findMany),
    );

    for (const call of createForUser.mock.calls) {
      expect(call[0].variables).toMatchObject({ inserted: '0', total: '0' });
    }
  });
});
