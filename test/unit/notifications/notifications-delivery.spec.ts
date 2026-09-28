import type { Notification } from '@prisma/client';
import { EventTypes } from '../../../src/events/catalog';
import type { OutboxConsumerContext } from '../../../src/events/outbox-consumer/outbox-consumer.types';
import { defaultProviders } from '../../../src/integrations/notifications/notifications.provider';
import type { NotificationProvider } from '../../../src/integrations/notifications/notifications.provider';
import type { PrismaService } from '../../../src/database/prisma.service';
import { testEnv } from '../../support/test-env';
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
    providerRef: null,
    nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
    readAt: null,
    sentAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface TenantMocks {
  update: jest.Mock;
  preferences: jest.Mock;
  user: jest.Mock;
  patient: jest.Mock;
}

function prismaWith(row: Notification, overrides: Partial<TenantMocks> = {}) {
  const mocks: TenantMocks = {
    update: jest.fn(async (args: { data: Partial<Notification> }) => ({ ...row, ...args.data })),
    preferences: jest.fn().mockResolvedValue([]),
    user: jest.fn().mockResolvedValue({ email: 'user-1@example.org', phone: '+254700000001' }),
    patient: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
  const prisma = {
    tenantFor: jest.fn(() => ({
      notification: { update: mocks.update },
      notificationPreference: { findMany: mocks.preferences },
      user: { findUnique: mocks.user },
      patient: { findUnique: mocks.patient },
    })),
  } as unknown as PrismaService;
  return { prisma, mocks };
}

function makeService(row: Notification, providerMap: ReturnType<typeof defaultProviders>, overrides: Partial<TenantMocks> = {}) {
  const { prisma, mocks } = prismaWith(row, overrides);
  return {
    service: new NotificationDeliveryService(prisma, providerMap, testEnv()),
    mocks,
  };
}

describe('notification consumer and delivery', () => {
  it('marks a delivery as sent with no-op providers', async () => {
    const row = notificationRow();
    const { service, mocks } = makeService(row, defaultProviders(testEnv()));

    const delivered = await service.send(row);

    expect(delivered.status).toBe('SENT');
    expect(delivered.sentAt).toBeInstanceOf(Date);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: row.id, organizationId: row.organizationId },
      data: {
        status: 'SENT',
        attemptCount: 1,
        errorCode: null,
        providerRef: null,
        sentAt: expect.any(Date),
      },
    });
  });

  it('persists the provider-side ref so a delivery can be correlated', async () => {
    const row = notificationRow();
    const provider: NotificationProvider = {
      channel: 'PUSH',
      enabled: true,
      send: jest.fn().mockResolvedValue({ delivered: true, ref: 'mail-42' }),
    };
    const { service, mocks } = makeService(row, new Map([['PUSH', provider]]));

    await service.send(row);

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerRef: 'mail-42' }),
      }),
    );
  });

  it('keeps a transient provider failure retryable without exposing provider details', async () => {
    const row = notificationRow();
    const failingProvider: NotificationProvider = {
      channel: 'PUSH',
      enabled: true,
      send: jest.fn().mockRejectedValue(new Error('provider secret diagnostic')),
    };
    const { service, mocks } = makeService(row, new Map([['PUSH', failingProvider]]));

    const delivered = await service.send(row);

    expect(delivered.status).toBe('PENDING');
    expect(delivered.attemptCount).toBe(1);
    expect(delivered.errorCode).toBe('DELIVERY_FAILED');
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: row.id, organizationId: row.organizationId },
      data: {
        status: 'PENDING',
        attemptCount: 1,
        errorCode: 'DELIVERY_FAILED',
        nextAttemptAt: expect.any(Date),
      },
    });
  });

  it('leaves a terminal row untouched so a retry cannot resurrect a send', async () => {
    const row = notificationRow({ status: 'SENT', sentAt: new Date(), attemptCount: 1 });
    const provider: NotificationProvider = {
      channel: 'PUSH',
      enabled: true,
      send: jest.fn(),
    };
    const { service, mocks } = makeService(row, new Map([['PUSH', provider]]));

    await expect(service.send(row)).resolves.toBe(row);
    expect(provider.send).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
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
      testEnv(),
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
