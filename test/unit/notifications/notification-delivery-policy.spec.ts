import type { Notification, NotificationChannel } from '@prisma/client';
import type { PrismaService } from '../../../src/database/prisma.service';
import {
  NotificationDeliveryError,
  type NotificationProvider,
} from '../../../src/integrations/notifications/notifications.provider';
import { testEnv } from '../../support/test-env';
import { NotificationConsumer } from '../../../src/modules/notifications/notifications.consumer';
import {
  NotificationDeliveryService,
  deliveryTargetFor,
  resolveOptOut,
  WILDCARD_PREFERENCE_CATEGORY,
} from '../../../src/modules/notifications/notifications-delivery.service';
import type { NotificationService } from '../../../src/modules/notifications/notifications.service';

const BASE_ROW: Notification = {
  id: 'notif-1',
  organizationId: 'org-1',
  recipientUserId: 'user-1',
  recipientPatientId: null,
  channel: 'EMAIL',
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
};

interface Harness {
  service: NotificationDeliveryService;
  update: jest.Mock;
  preferences: jest.Mock;
  user: jest.Mock;
  patient: jest.Mock;
  provider: NotificationProvider;
}

function harness(
  overrides: {
    row?: Partial<Notification>;
    provider?: Partial<NotificationProvider>;
    preferences?: Array<{ category: string; enabled: boolean }>;
    user?: { email: string | null; phone: string | null } | null;
    patient?: { email: string | null; phone: string | null } | null;
    env?: Record<string, string>;
    channel?: NotificationChannel;
  } = {},
): Harness {
  const row = { ...BASE_ROW, ...overrides.row };
  const channel = (overrides.channel ?? row.channel) as NotificationChannel;
  const provider: NotificationProvider = {
    channel,
    enabled: true,
    send: jest.fn().mockResolvedValue({ delivered: true }),
    ...overrides.provider,
  };

  const update = jest.fn(async (args: { data: Partial<Notification> }) => ({
    ...row,
    ...args.data,
  }));
  const preferences = jest.fn().mockResolvedValue(overrides.preferences ?? []);
  const user = jest
    .fn()
    .mockResolvedValue(
      overrides.user === undefined
        ? { email: 'user-1@example.org', phone: '+254700000001' }
        : overrides.user,
    );
  const patient = jest.fn().mockResolvedValue(overrides.patient ?? null);

  const prisma = {
    tenantFor: jest.fn(() => ({
      notification: { update },
      notificationPreference: { findMany: preferences },
      user: { findUnique: user },
      patient: { findUnique: patient },
    })),
  } as unknown as PrismaService;

  const service = new NotificationDeliveryService(
    prisma,
    new Map([[channel, provider]]),
    testEnv(overrides.env),
  );
  return { service, update, preferences, user, patient, provider };
}

describe('notification delivery policy (patch P6)', () => {
  describe('resolveOptOut', () => {
    it('defaults to enabled — a recipient must opt out', () => {
      expect(resolveOptOut([], 'task.assigned')).toEqual({
        optedOut: false,
        matchedCategory: null,
      });
    });

    it('lets the template category win over the blanket catch-all', () => {
      expect(
        resolveOptOut(
          [
            { category: WILDCARD_PREFERENCE_CATEGORY, enabled: false },
            { category: 'task.assigned', enabled: true },
          ],
          'task.assigned',
        ),
      ).toEqual({ optedOut: false, matchedCategory: 'task.assigned' });
    });

    it('honours a blanket opt-out for templates with no row of their own', () => {
      expect(
        resolveOptOut(
          [{ category: WILDCARD_PREFERENCE_CATEGORY, enabled: false }],
          'lab.result.released',
        ),
      ).toEqual({ optedOut: true, matchedCategory: WILDCARD_PREFERENCE_CATEGORY });
    });
  });

  describe('deliveryTargetFor', () => {
    it('resolves the address on file for EMAIL and SMS', () => {
      const recipient = { email: 'a@example.org', phone: '+254700000001' };
      expect(deliveryTargetFor('EMAIL', 'user-1', recipient)).toEqual({
        kind: 'address',
        address: 'a@example.org',
      });
      expect(deliveryTargetFor('SMS', 'user-1', recipient)).toEqual({
        kind: 'address',
        address: '+254700000001',
      });
    });

    it('addresses in-app and push by recipient id (no address needed)', () => {
      const recipient = { email: null, phone: null };
      expect(deliveryTargetFor('IN_APP', 'user-1', recipient)).toEqual({
        kind: 'recipient-id',
        to: 'user-1',
      });
      expect(deliveryTargetFor('PUSH', 'user-1', recipient)).toEqual({
        kind: 'recipient-id',
        to: 'user-1',
      });
    });

    it('reports a missing address instead of sending to an empty recipient', () => {
      expect(
        deliveryTargetFor('EMAIL', 'user-1', { email: null, phone: '+254700' }),
      ).toEqual({
        kind: 'missing-address',
      });
      expect(deliveryTargetFor('EMAIL', 'user-1', null)).toEqual({
        kind: 'missing-address',
      });
    });

    it('reports a row with no recipient at all', () => {
      expect(deliveryTargetFor('EMAIL', null, null)).toEqual({ kind: 'no-recipient' });
    });
  });

  describe('opt-out enforcement on send', () => {
    it('suppresses a delivery the recipient opted out of, without contacting the provider', async () => {
      const { service, provider, update, preferences } = harness({
        preferences: [{ category: 'task.assigned', enabled: false }],
      });

      const row = await service.send(BASE_ROW);

      expect(row.status).toBe('SUPPRESSED');
      expect(row.errorCode).toBe('RECIPIENT_OPTED_OUT');
      // No attempt was made, so nothing should be counted.
      expect(row.attemptCount).toBe(0);
      expect(provider.send).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({
        where: { id: BASE_ROW.id, organizationId: BASE_ROW.organizationId },
        data: { status: 'SUPPRESSED', errorCode: 'RECIPIENT_OPTED_OUT' },
      });
      // The preference lookup is scoped to the recipient, channel and category.
      expect(preferences).toHaveBeenCalledWith({
        where: {
          organizationId: BASE_ROW.organizationId,
          channel: 'EMAIL',
          category: { in: ['task.assigned', WILDCARD_PREFERENCE_CATEGORY] },
          recipientUserId: 'user-1',
        },
        select: { category: true, enabled: true },
      });
    });

    it('suppresses a channel with no address on file instead of retrying forever', async () => {
      const { service, provider } = harness({ user: { email: null, phone: null } });

      const row = await service.send(BASE_ROW);

      expect(row.status).toBe('SUPPRESSED');
      expect(row.errorCode).toBe('RECIPIENT_ADDRESS_MISSING');
      expect(provider.send).not.toHaveBeenCalled();
    });

    it('reads a patient preference for a patient recipient', async () => {
      const { service, preferences, patient } = harness({
        row: { recipientUserId: null, recipientPatientId: 'patient-1' },
        patient: { email: 'patient@example.org', phone: null },
        preferences: [{ category: WILDCARD_PREFERENCE_CATEGORY, enabled: false }],
      });

      const row = await service.send({
        ...BASE_ROW,
        recipientUserId: null,
        recipientPatientId: 'patient-1',
      });

      expect(row.status).toBe('SUPPRESSED');
      expect(preferences).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ recipientPatientId: 'patient-1' }),
        }),
      );
      expect(patient).toHaveBeenCalled();
    });

    it('sends when the recipient has re-enabled the category', async () => {
      const { service, provider } = harness({
        preferences: [
          { category: 'task.assigned', enabled: true },
          { category: WILDCARD_PREFERENCE_CATEGORY, enabled: false },
        ],
      });

      const row = await service.send(BASE_ROW);

      expect(row.status).toBe('SENT');
      expect(provider.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user-1@example.org' }),
      );
    });
  });

  describe('address resolution', () => {
    it('sends to the address on file, not the recipient id', async () => {
      const { service, provider } = harness();

      await service.send(BASE_ROW);

      expect(provider.send).toHaveBeenCalledWith({
        to: 'user-1@example.org',
        subject: BASE_ROW.subject,
        body: BASE_ROW.body,
        variables: { taskId: 'task-1' },
        idempotencyKey: BASE_ROW.id,
      });
    });

    it('carries the notification id as the provider idempotency key', async () => {
      const { service, provider } = harness();

      await service.send(BASE_ROW);

      // At-least-once delivery: a retry may re-send, so the receiver dedupes here.
      expect(provider.send).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'notif-1' }),
      );
    });
  });

  describe('retry ladder', () => {
    it('backs off exponentially from the configured base', async () => {
      const { service, update } = harness({
        row: { attemptCount: 1 },
        env: { NOTIFICATION_DELIVERY_RETRY_BASE_MS: '30000' },
        provider: { send: jest.fn().mockRejectedValue(new Error('smtp down')) },
      });

      await service.send({ ...BASE_ROW, attemptCount: 1 });

      const written = update.mock.calls[0]![0].data as {
        nextAttemptAt: Date;
        attemptCount: number;
      };
      expect(written.attemptCount).toBe(2);
      const delay = written.nextAttemptAt.getTime() - Date.now();
      expect(delay).toBeGreaterThan(29_000);
      expect(delay).toBeLessThanOrEqual(60_000);
    });

    it('fails terminally once the attempt budget is spent', async () => {
      const { service, update } = harness({
        row: { attemptCount: 4 },
        env: { NOTIFICATION_DELIVERY_MAX_ATTEMPTS: '5' },
        provider: { send: jest.fn().mockRejectedValue(new Error('smtp down')) },
      });

      const row = await service.send({ ...BASE_ROW, attemptCount: 4 });

      expect(row.status).toBe('FAILED');
      expect(row.attemptCount).toBe(5);
      expect(update.mock.calls[0]![0].data).toEqual({
        status: 'FAILED',
        attemptCount: 5,
        errorCode: 'DELIVERY_FAILED',
      });
    });

    it('treats a rejected payload (4xx) as permanent — a retry cannot fix it', async () => {
      const { service } = harness({
        row: { attemptCount: 0 },
        provider: {
          send: jest
            .fn()
            .mockRejectedValue(new NotificationDeliveryError('400', 'PROVIDER_REJECTED')),
        },
      });

      const row = await service.send(BASE_ROW);

      expect(row.status).toBe('FAILED');
      expect(row.errorCode).toBe('PROVIDER_REJECTED');
    });

    it('retries a provider that is reachable but unavailable (5xx/timeout)', async () => {
      const { service } = harness({
        provider: {
          send: jest
            .fn()
            .mockRejectedValue(
              new NotificationDeliveryError('webhook 503', 'PROVIDER_UNAVAILABLE'),
            ),
        },
      });

      const row = await service.send(BASE_ROW);

      expect(row.status).toBe('PENDING');
      expect(row.errorCode).toBe('PROVIDER_UNAVAILABLE');
    });

    it('retries a provider that accepts without confirming', async () => {
      const { service } = harness({
        provider: { send: jest.fn().mockResolvedValue({ delivered: false }) },
      });

      const row = await service.send(BASE_ROW);

      expect(row.status).toBe('PENDING');
      expect(row.errorCode).toBe('DELIVERY_NOT_CONFIRMED');
    });

    it('fails a channel with no configured provider without retrying it', async () => {
      const prisma = {
        tenantFor: jest.fn(() => ({
          notification: {
            update: jest.fn(async (args: { data: Partial<Notification> }) => ({
              ...BASE_ROW,
              ...args.data,
            })),
          },
        })),
      } as unknown as PrismaService;
      const service = new NotificationDeliveryService(prisma, new Map(), testEnv());

      const row = await service.send(BASE_ROW);

      expect(row.status).toBe('FAILED');
      // Distinct from a configured-but-down provider, which is retryable.
      expect(row.errorCode).toBe('PROVIDER_NOT_CONFIGURED');
    });

    it('fails a row with no recipient at all', async () => {
      const { service } = harness({
        row: { recipientUserId: null, recipientPatientId: null },
      });

      const row = await service.send({
        ...BASE_ROW,
        recipientUserId: null,
        recipientPatientId: null,
      });

      expect(row.status).toBe('FAILED');
      expect(row.errorCode).toBe('RECIPIENT_REQUIRED');
    });
  });

  describe('channel fan-out', () => {
    function consumerFor(offsiteChannels: string) {
      const createForUser = jest.fn(async (input: { id: string; channel: string }) => ({
        ...BASE_ROW,
        id: input.id,
        channel: input.channel as NotificationChannel,
      }));
      const send = jest.fn(async () => ({ ...BASE_ROW, status: 'SENT' as const }));
      const consumer = new NotificationConsumer(
        { createForUser } as unknown as NotificationService,
        { send } as unknown as NotificationDeliveryService,
        testEnv({ NOTIFICATION_OFFSITE_CHANNELS: offsiteChannels }),
      );
      return { consumer, createForUser, send };
    }

    const context = {
      row: {
        id: 'event-9',
        organizationId: 'org-1',
        type: 'Scheduling.AppointmentBooked',
        version: 1,
        aggregateType: 'appointment',
        aggregateId: 'appointment-9',
        actorId: 'user-1',
        correlationId: null,
        occurredAt: new Date(),
        payload: { appointmentId: 'appointment-9' },
        attemptCount: 0,
      },
      db: {},
      organizationId: 'org-1',
    };

    it('produces in-app only by default (a send that leaves the system is opt-in)', async () => {
      const { consumer, createForUser } = consumerFor('');

      await consumer.handle(context as never);

      expect(createForUser.mock.calls.map((call) => call[0].channel)).toEqual(['IN_APP']);
    });

    it('fans out to the configured off-system channels with distinct ids', async () => {
      const { consumer, createForUser, send } = consumerFor('EMAIL, SMS , nonsense');

      await consumer.handle(context as never);

      expect(createForUser.mock.calls.map((call) => call[0])).toEqual([
        expect.objectContaining({ id: 'notif-event-9', channel: 'IN_APP' }),
        expect.objectContaining({ id: 'notif-event-9-email', channel: 'EMAIL' }),
        expect.objectContaining({ id: 'notif-event-9-sms', channel: 'SMS' }),
      ]);
      expect(send).toHaveBeenCalledTimes(3);
    });
  });
});
