import type { Notification } from '@prisma/client';
import { EventTypes } from '../../../src/events/catalog';
import type { OutboxConsumerContext } from '../../../src/events/outbox-consumer/outbox-consumer.types';
import { defaultProviders } from '../../../src/integrations/notifications/notifications.provider';
import type { NotificationProvider } from '../../../src/integrations/notifications/notifications.provider';
import type { PrismaService } from '../../../src/database/prisma.service';
import {
  NotificationConsumer,
  notificationIdForEvent,
} from '../../../src/modules/notifications/notifications.consumer';
import { NotificationDeliveryService } from '../../../src/modules/notifications/notifications-delivery.service';
import type { NotificationService } from '../../../src/modules/notifications/notifications.service';

function notificationRow(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-event-1',
    organizationId: 'org-1',
    recipientUserId: 'user-1',
    recipientPatientId: null,
    channel: 'PUSH',
    templateKey: 'task.assigned',
    subject: 'A task was assigned',
    body: 'A task status changed. Reference: task-1.',
    variables: { taskId: 'task-1' },
    status: 'PENDING',
    attemptCount: 0,
    errorCode: null,
    readAt: null,
    sentAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function prismaWithUpdate(row: Notification, update: jest.Mock) {
  return {
    tenantFor: jest.fn(() => ({
      notification: {
        update: jest.fn(async (args: { data: Partial<Notification> }) => {
          update(args);
          return { ...row, ...args.data };
        }),
      },
    })),
  } as unknown as PrismaService;
}

describe('notification consumer and delivery', () => {
  it('marks a delivery as sent with no-op providers', async () => {
    const row = notificationRow();
    const update = jest.fn();
    const service = new NotificationDeliveryService(
      prismaWithUpdate(row, update),
      defaultProviders(),
    );

    const delivered = await service.send(row);

    expect(delivered.status).toBe('SENT');
    expect(delivered.sentAt).toBeInstanceOf(Date);
    expect(update).toHaveBeenCalledWith({
      where: { id: row.id, organizationId: row.organizationId },
      data: {
        status: 'SENT',
        attemptCount: 1,
        errorCode: null,
        sentAt: expect.any(Date),
      },
    });
  });

  it('marks a provider failure without exposing provider details', async () => {
    const row = notificationRow();
    const update = jest.fn();
    const failingProvider: NotificationProvider = {
      channel: 'PUSH',
      send: jest.fn().mockRejectedValue(new Error('provider secret diagnostic')),
    };
    const service = new NotificationDeliveryService(
      prismaWithUpdate(row, update),
      new Map([['PUSH', failingProvider]]),
    );

    const delivered = await service.send(row);

    expect(delivered.status).toBe('FAILED');
    expect(delivered.attemptCount).toBe(1);
    expect(delivered.errorCode).toBe('DELIVERY_FAILED');
    expect(update).toHaveBeenCalledWith({
      where: { id: row.id, organizationId: row.organizationId },
      data: {
        status: 'FAILED',
        attemptCount: 1,
        errorCode: 'DELIVERY_FAILED',
      },
    });
  });

  it('pins one notification id to each outbox event', async () => {
    const row = notificationRow({ channel: 'IN_APP' });
    const createForUser = jest.fn(
      async (_input: { id: string; variables: Record<string, string> }) => row,
    );
    const send = jest.fn(async () => row);
    const consumer = new NotificationConsumer(
      { createForUser } as unknown as NotificationService,
      { send } as unknown as NotificationDeliveryService,
    );
    const context = {
      row: {
        id: 'event-1',
        organizationId: 'org-1',
        type: EventTypes.AppointmentBooked,
        version: 1,
        aggregateType: 'appointment',
        aggregateId: 'appointment-1',
        actorId: 'user-1',
        correlationId: null,
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        payload: { appointmentId: 'appointment-1', patientId: 'patient-1' },
        attemptCount: 0,
      },
      db: {},
      organizationId: 'org-1',
    } as unknown as OutboxConsumerContext;

    await consumer.handle(context);
    await consumer.handle(context);

    expect(notificationIdForEvent('event-1')).toBe('notif-event-1');
    expect(createForUser).toHaveBeenCalledTimes(2);
    expect(createForUser.mock.calls[0]![0]).toMatchObject({
      id: 'notif-event-1',
      variables: { appointmentId: 'appointment-1' },
    });
    expect(createForUser.mock.calls[1]![0]).toMatchObject({
      id: 'notif-event-1',
      variables: { appointmentId: 'appointment-1' },
    });
    expect(createForUser.mock.calls[0]![0].variables).not.toHaveProperty('patientId');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
