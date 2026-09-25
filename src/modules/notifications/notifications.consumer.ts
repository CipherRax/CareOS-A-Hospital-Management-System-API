import { Injectable } from '@nestjs/common';
import { EventTypes } from '../../events/catalog';
import type {
  OutboxConsumer,
  OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { NotificationDeliveryService } from './notifications-delivery.service';
import { NotificationService } from './notifications.service';

export function notificationIdForEvent(eventId: string): string {
  return `notif-${eventId}`;
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
  ) {}

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

    const notification = await this.notifications.createForUser({
      id: notificationIdForEvent(ctx.row.id),
      userId: actorId,
      channel: 'IN_APP',
      templateKey,
      variables,
      organizationId: ctx.organizationId,
    });
    await this.delivery.send(notification);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
