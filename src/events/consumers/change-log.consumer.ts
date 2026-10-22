import { Injectable } from '@nestjs/common';
import {
  type OutboxConsumer,
  type OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { newId } from '../../common/lib/uuidv7';
import { EVENT_TO_RESOURCE, SYNC_BACKED_EVENTS, resourceIdFromPayload } from '../../modules/sync/domain/sync-resources';

/**
 * Change-log projection for offline sync (brief §10), fed from the outbox.
 *
 * Every syncable domain event writes one `ChangeLog` row keyed by its source
 * event (`organizationId + sourceEventId`, unique) so replays upsert instead of
 * duplicating. Rows carry only ids and metadata (never PHI) and the permission
 * the read path will require, so a client can never pull a change it could not
 * read live.
 *
 * `operation` is UPSERT for every shipped event: the domain models no
 * hard-deletes (archival/merge are state changes). A future event may map to
 * DELETE explicitly.
 */
@Injectable()
export class ChangeLogProjectionConsumer implements OutboxConsumer {
  readonly name = 'change-log-projection';

  readonly eventTypes: ReadonlyArray<string> = SYNC_BACKED_EVENTS;

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const resource = EVENT_TO_RESOURCE.get(ctx.row.type);
    if (!resource) return;

    const payload = (ctx.row.payload ?? {}) as Record<string, unknown>;
    const resourceId = resourceIdFromPayload(resource, payload, ctx.row.aggregateId);
    if (!resourceId) return;

    const branchId =
      resource.branchKey && typeof payload[resource.branchKey] === 'string'
        ? (payload[resource.branchKey] as string)
        : null;

    await ctx.db.changeLog.upsert({
      where: {
        organizationId_sourceEventId: {
          organizationId: ctx.organizationId,
          sourceEventId: ctx.row.id,
        },
      },
      create: {
        id: newId(),
        organizationId: ctx.organizationId,
        resourceType: resource.type,
        resourceId,
        operation: 'UPSERT',
        version: ctx.row.version,
        branchId,
        requiredPermission: resource.permission,
        actorId: ctx.row.actorId,
        sourceEventId: ctx.row.id,
        occurredAt: ctx.row.occurredAt,
      },
      update: {},
    });
  }
}
