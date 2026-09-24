import { Injectable, Logger, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { OUTBOX_DISPATCHER } from './outbox.tokens';

export interface OutboxRow {
  id: string;
  organizationId: string;
  type: string;
  version: number;
  aggregateType: string;
  aggregateId: string;
  actorId: string | null;
  correlationId: string | null;
  occurredAt: Date;
  payload: Prisma.JsonValue;
  attemptCount: number;
}

/**
 * Dispatches an outbox event to its consumers. Phase 0 ships a no-op dispatcher
 * (nothing consumes yet); BullMQ-based consumers are added with the events/queues
 * work. Returning `false` keeps the event for retry.
 */
export interface OutboxDispatcher {
  dispatch(row: OutboxRow): Promise<boolean>;
}

export const MAX_OUTBOX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 1_000;

/**
 * Claims ready outbox rows with `FOR UPDATE SKIP LOCKED` (safe under concurrent
 * worker instances), dispatches, and records PUBLISHED/FAILED/DEAD. Runs on the
 * worker entrypoint. Idempotent by construction: dispatchers dedupe via
 * ProcessedEvent (consumer + eventId).
 */
@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_DISPATCHER) private readonly dispatcher: OutboxDispatcher,
  ) {}

  /**
   * @returns number of events successfully published in this pass.
   */
  async publishReadyEvents(limit = 100): Promise<number> {
    const db = this.prisma.unscoped();

    // Claim ready rows in a SHORT transaction (the SKIP LOCKED read releases as
    // soon as it commits). Dispatch happens OUTSIDE any transaction — consumers
    // perform network-bound projection work, and Prisma interactive
    // transactions must not be held open across remote side-effects.
    const rows = await db.$transaction(async (tx) => {
      return tx.$queryRaw<OutboxRow[]>`
        SELECT "id", "organizationId", "type", "version", "aggregateType", "aggregateId",
               "actorId", "correlationId", "occurredAt", "payload", "attemptCount"
        FROM "outbox_events"
        WHERE "status" = 'PENDING'
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
        ORDER BY "occurredAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
    });

    let published = 0;

    for (const row of rows) {
      let delivered = false;
      try {
        delivered = await this.dispatcher.dispatch(row);
      } catch (err) {
        this.logger.error(
          { eventId: row.id, type: row.type, err: String(err) },
          'outbox dispatch failed',
        );
      }

      if (delivered) {
        await db.$transaction((tx) =>
          tx.outboxEvent.update({
            where: { id: row.id, organizationId: row.organizationId },
            data: { status: 'PUBLISHED', publishedAt: new Date() },
          }),
        );
        published += 1;
        continue;
      }

      const next = row.attemptCount + 1;
      if (next >= MAX_OUTBOX_ATTEMPTS) {
        await db.$transaction((tx) =>
          tx.outboxEvent.update({
            where: { id: row.id, organizationId: row.organizationId },
            data: {
              status: 'DEAD',
              deadAt: new Date(),
              attemptCount: next,
              lastError: 'max attempts reached',
            },
          }),
        );
        this.logger.warn({ eventId: row.id, type: row.type }, 'outbox event dead');
      } else {
        await db.$transaction((tx) =>
          tx.outboxEvent.update({
            where: { id: row.id, organizationId: row.organizationId },
            data: {
              attemptCount: next,
              nextAttemptAt: new Date(Date.now() + BASE_BACKOFF_MS * 2 ** next),
              lastError: 'dispatch not acknowledged',
            },
          }),
        );
      }
    }

    return published;
  }
}
