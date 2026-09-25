import { Inject, Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  NOTIFICATION_PROVIDERS,
  type NotificationProvider,
} from '../../integrations/notifications/notifications.provider';
import type { NotificationChannel } from '@prisma/client';

export type DeliveryPlan =
  | { provider: NotificationProvider; error?: undefined }
  | { provider?: undefined; error: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_CHANNEL_MISMATCH' };

export function planDelivery(
  channel: NotificationChannel,
  providers: ReadonlyMap<NotificationChannel, NotificationProvider>,
): DeliveryPlan {
  const provider = providers.get(channel);
  if (!provider) return { error: 'PROVIDER_UNAVAILABLE' };
  if (provider.channel !== channel) return { error: 'PROVIDER_CHANNEL_MISMATCH' };
  return { provider };
}

@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_PROVIDERS)
    private readonly providers: ReadonlyMap<NotificationChannel, NotificationProvider>,
  ) {}

  async send(row: Notification): Promise<Notification> {
    if (row.status === 'SENT') return row;

    const db = this.prisma.tenantFor(row.organizationId);
    const attemptCount = row.attemptCount + 1;
    const plan = planDelivery(row.channel, this.providers);
    if (plan.error) {
      return db.notification.update({
        where: { id: row.id, organizationId: row.organizationId },
        data: {
          status: 'FAILED',
          attemptCount,
          errorCode: plan.error,
        },
      });
    }

    const to = row.recipientUserId ?? row.recipientPatientId;
    if (!to) {
      return db.notification.update({
        where: { id: row.id, organizationId: row.organizationId },
        data: {
          status: 'FAILED',
          attemptCount,
          errorCode: 'RECIPIENT_REQUIRED',
        },
      });
    }

    try {
      const result = await plan.provider.send({
        to,
        subject: row.subject,
        body: row.body,
        variables: providerVariables(row.variables),
      });
      if (!result.delivered) {
        return db.notification.update({
          where: { id: row.id, organizationId: row.organizationId },
          data: {
            status: 'FAILED',
            attemptCount,
            errorCode: 'DELIVERY_NOT_CONFIRMED',
          },
        });
      }
    } catch {
      return db.notification.update({
        where: { id: row.id, organizationId: row.organizationId },
        data: {
          status: 'FAILED',
          attemptCount,
          errorCode: 'DELIVERY_FAILED',
        },
      });
    }

    return db.notification.update({
      where: { id: row.id, organizationId: row.organizationId },
      data: {
        status: 'SENT',
        attemptCount,
        errorCode: null,
        sentAt: new Date(),
      },
    });
  }
}

function providerVariables(value: Prisma.JsonValue | null): Record<string, string> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      entry === null
        ? ''
        : typeof entry === 'object'
          ? JSON.stringify(entry)
          : String(entry),
    ]),
  );
}
