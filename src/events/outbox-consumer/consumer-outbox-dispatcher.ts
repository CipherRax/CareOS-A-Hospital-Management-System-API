import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { newId } from '../../common/lib/uuidv7';
import type { OutboxDispatcher, OutboxRow } from '../../database/outbox-publisher.service';
import { OUTBOX_CONSUMERS, type OutboxConsumer } from './outbox-consumer.types';

/**
 * Dispatches an outbox row to every consumer subscribed to its event type.
 *
 * - At-most-one-successful delivery per consumer is guaranteed by the
 *   ProcessedEvent dedup row (unique on organizationId + consumer + eventId).
 * - Consumers run on the unscoped client; they set organizationId explicitly.
 * - A row is acknowledged only when ALL its consumers succeeded; failures
 *   surface back to OutboxPublisherService for retry/backoff/DEAD handling.
 */
@Injectable()
export class ConsumerOutboxDispatcher implements OutboxDispatcher {
  private readonly logger = new Logger(ConsumerOutboxDispatcher.name);
  private readonly byType: Map<string, readonly OutboxConsumer[]>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_CONSUMERS) consumers: readonly OutboxConsumer[],
  ) {
    const index = new Map<string, OutboxConsumer[]>();
    for (const consumer of consumers) {
      for (const type of consumer.eventTypes) {
        const list = index.get(type) ?? [];
        list.push(consumer);
        index.set(type, list);
      }
    }
    this.byType = index;
  }

  async dispatch(row: OutboxRow): Promise<boolean> {
    const consumers = this.byType.get(row.type) ?? [];
    if (consumers.length === 0) return true;

    const db = this.prisma.unscoped();

    for (const consumer of consumers) {
      const already = await db.processedEvent.findUnique({
        where: {
          organizationId_consumer_eventId: {
            organizationId: row.organizationId,
            consumer: consumer.name,
            eventId: row.id,
          },
        },
        select: { id: true },
      });
      if (already) continue;

      try {
        await consumer.handle({
          row,
          db,
          organizationId: row.organizationId,
        });
      } catch (err) {
        this.logger.error(
          {
            eventId: row.id,
            type: row.type,
            consumer: consumer.name,
            err: err instanceof Error ? err.message : String(err),
          },
          'outbox consumer failed',
        );
        return false;
      }

      await db.processedEvent.create({
        data: {
          id: newId(),
          organizationId: row.organizationId,
          consumer: consumer.name,
          eventId: row.id,
        },
      });
    }

    return true;
  }
}