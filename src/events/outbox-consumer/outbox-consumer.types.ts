import type { PrismaClient } from '@prisma/client';
import type { OutboxRow } from '../../database/outbox-publisher.service';

/**
 * Consumer plumbing for the transactional outbox (see ADR). Consumers are pure
 * projections/side-effects fed from OutboxEvent rows after commit. Dispatch is
 * a Noop stand-in until workers run; e2e drives it synchronously through the
 * publisher to prove the timeline projection.
 *
 * Consumers run on the RAW (unscoped) Prisma client because dispatch happens
 * outside request scope: every write MUST set organizationId explicitly, and
 * every consumer MUST be idempotent (the dispatcher records a ProcessedEvent
 * row after success; replays reuse it).
 */
export interface OutboxConsumerContext {
  readonly row: OutboxRow;
  /** Raw Prisma client. Pass organizationId explicitly on every write. */
  readonly db: PrismaClient;
  readonly organizationId: string;
}

export interface OutboxConsumer {
  /** Stable consumer name — stored in ProcessedEvent for dedup. */
  readonly name: string;
  /** EventTypes (catalog.ts) this consumer subscribes to. */
  readonly eventTypes: ReadonlyArray<string>;
  handle(ctx: OutboxConsumerContext): Promise<void>;
}

/** Multi-provider token: an array of all registered consumers. */
export const OUTBOX_CONSUMERS = Symbol('OUTBOX_CONSUMERS');