import { Injectable, Logger } from '@nestjs/common';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EventTypes } from '../../events/catalog';
import type {
  OutboxConsumer,
  OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { NotificationDeliveryService } from '../notifications/notifications-delivery.service';
import { NotificationService } from '../notifications/notifications.service';

/**
 * Deterministic notification id for one (event, recipient) pair. The dispatcher
 * records a `ProcessedEvent` row after success, but a crash between the
 * notification write and that write replays the event; the fixed id makes
 * `createForUser`'s upsert collapse the replay instead of double-notifying.
 */
export function codingImportNotificationId(eventId: string, userId: string): string {
  return `notif-${eventId}-coding-${userId}`;
}

/**
 * `Reference.CodingSystemImported` side-effect (patch P7).
 *
 * The event used to be published and dropped: the dispatcher acks an event with
 * no subscriber, so importing a coding reference was invisible to everyone who
 * selects codes from it. This consumer fans a PHI-neutral "the reference set
 * changed" notice out to the users who own the reference — the roles holding
 * `coding.manage`, not every clinician — with the added/total counts.
 *
 * What this deliberately does *not* do, and why: the import path upserts the
 * concepts in the payload and only ever sets `isActive: true`. It never
 * deactivates or deletes a concept, and `Diagnosis` snapshots `code`/`description`
 * at authoring time, so an import cannot orphan an existing
 * `Diagnosis.codeConceptId` or silently change recorded text. There is therefore
 * no integrity damage to reconcile at this point; the only true consequence is
 * that the set people select from has moved, which is what this notifies. A
 * future *deactivation* endpoint would need a real reconciliation pass, and
 * `docs/limitations.md` says so.
 */
@Injectable()
export class CodingReferenceConsumer implements OutboxConsumer {
  readonly name = 'coding-reference';
  readonly eventTypes: ReadonlyArray<string> = [EventTypes.CodingSystemImported];

  private readonly logger = new Logger(CodingReferenceConsumer.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = asRecord(ctx.row.payload);
    const codingSystemId = firstString(payload.codingSystemId) ?? ctx.row.aggregateId;
    if (!codingSystemId) {
      this.logger.warn(`coding import ${ctx.row.id} carried no codingSystemId; ignored`);
      return;
    }

    const recipients = await this.referenceOwners(ctx);
    if (recipients.length === 0) {
      this.logger.warn(
        `coding import ${ctx.row.id} has no coding.manage recipient; nothing to notify`,
      );
      return;
    }

    for (const userId of recipients) {
      const notification = await this.notifications.createForUser({
        id: codingImportNotificationId(ctx.row.id, userId),
        userId,
        channel: 'IN_APP',
        templateKey: 'coding.reference_updated',
        variables: {
          codingSystemId,
          inserted: String(countOf(payload.inserted)),
          total: String(countOf(payload.total)),
        },
        organizationId: ctx.organizationId,
      });
      await this.delivery.send(notification);
    }
  }

  /**
   * Distinct active users in the organization whose roles include
   * `coding.manage`. `Role.permissions` is a `String[]`, so the permission
   * filter is a containment check the database can do; the `distinct` collapses
   * a user holding two such roles.
   */
  private async referenceOwners(ctx: OutboxConsumerContext): Promise<string[]> {
    const assignments = await ctx.db.userRole.findMany({
      where: {
        organizationId: ctx.organizationId,
        role: { permissions: { has: PERMISSION_GROUPS.codings.manage } },
        user: { status: 'ACTIVE' },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return assignments.map((row) => row.userId);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Counts arrive as JSON numbers; a missing/odd payload means 0, not NaN. */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
