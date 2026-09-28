import { Inject, Injectable } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import { ENV, type Env } from '../../config/config.module';
import { EventTypes } from '../../events/catalog';
import type {
  OutboxConsumer,
  OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { parseOffsiteChannels } from '../../integrations/notifications/notifications.provider';
import { NotificationDeliveryService } from './notifications-delivery.service';
import { NotificationService } from './notifications.service';

export function notificationIdForEvent(
  eventId: string,
  channel: NotificationChannel = 'IN_APP',
): string {
  // IN_APP keeps the historical id so existing rows and the event→notification
  // mapping stay stable; off-system channels get a per-channel suffix.
  return channel === 'IN_APP' ? `notif-${eventId}` : `notif-${eventId}-${channel.toLowerCase()}`;
}

@Injectable()
export class NotificationConsumer implements OutboxConsumer {
  readonly name = 'notifications';
  readonly eventTypes: ReadonlyArray<string> = [
    EventTypes.AppointmentBooked,
    EventTypes.TaskStatusChanged,
    EventTypes.LabResultReleased,
  ];

  constructor(
    private readonly notifications: NotificationService,
    private readonly delivery: NotificationDeliveryService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Channels one event fans out to. IN_APP is always produced (it is the
   * in-product record); the off-system channels are opt-in per deployment
   * because a send that leaves the system cannot be unsent, and a recipient
   * cannot be asked for consent for a channel they never asked to join.
   */
  channels(): NotificationChannel[] {
    return ['IN_APP', ...parseOffsiteChannels(this.env.NOTIFICATION_OFFSITE_CHANNELS)];
  }

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const actorId = ctx.row.actorId;
    if (!actorId) return;

    const payload = asRecord(ctx.row.payload);
    let templateKey: string;
    let variables: Record<string, string>;
    if (ctx.row.type === EventTypes.AppointmentBooked) {
      templateKey = 'appointment.booked';
      const appointmentId = firstString(payload.appointmentId) ?? ctx.row.aggregateId;
      variables = { appointmentId };
    } else if (ctx.row.type === EventTypes.TaskStatusChanged) {
      templateKey = 'task.assigned';
      const taskId = firstString(payload.taskId) ?? ctx.row.aggregateId;
      variables = { taskId };
    } else if (ctx.row.type === EventTypes.LabResultReleased) {
      templateKey = 'lab.result.released';
      const labResultId =
        firstString(payload.labResultId) ??
        firstString(payload.resultId) ??
        ctx.row.aggregateId;
      variables = { labResultId };
    } else {
      return;
    }

    for (const channel of this.channels()) {
      const notification = await this.notifications.createForUser({
        id: notificationIdForEvent(ctx.row.id, channel),
        userId: actorId,
        channel,
        templateKey,
        variables,
        organizationId: ctx.organizationId,
      });
      await this.delivery.send(notification);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
