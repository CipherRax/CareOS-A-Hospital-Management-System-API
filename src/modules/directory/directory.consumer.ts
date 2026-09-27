import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import {
  type OutboxConsumer,
  type OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { EventTypes } from '../../events/catalog';
import { REDIS_CLIENT } from '../../database/redis.tokens';

const REV_KEY = 'directory:rev';

/**
 * Public-directory projection side-effect, fed from the outbox (ADR-038). When
 * an org publishes/updates its branch listing, the public cache revision is
 * bumped so anonymous nearby/search/profile reads are rebuilt. Payloads carry
 * IDs/slug only (never PHI). Idempotent by construction: bumping a counter is
 * a no-op on replays; the expensive work (projection write) already happened
 * in the publishing transaction.
 */
@Injectable()
export class PublicListingConsumer implements OutboxConsumer {
  readonly name = 'public-directory-cache';
  readonly eventTypes: ReadonlyArray<string> = [EventTypes.PublicListingChanged];

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async handle(_ctx: OutboxConsumerContext): Promise<void> {
    await this.redis.incr(REV_KEY).catch(() => {});
  }
}