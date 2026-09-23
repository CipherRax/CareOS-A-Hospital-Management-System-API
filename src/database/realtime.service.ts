import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.tokens';

/**
 * Realtime fan-out over Redis pub/sub. Domain services publish small, PHI-free
 * events after their transaction commits (best-effort, fail-open); SSE streams
 * subscribe. The transactional outbox remains the durable delivery path — this
 * is a live-update hint layer, not a source of truth.
 */

export interface RealtimeEvent {
  /** EventTypes name (or a topic-local type like `queue.entry.created`). */
  event: string;
  version: number;
  aggregateId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /** Channel addressed by tenant + topic (never by PHI). */
  channel(organizationId: string, topic: string): string {
    return `careos:realtime:${organizationId}:${topic}`;
  }

  /**
   * Publishes one event over a tenant channel. Fire-and-forget: a transient
   * Redis failure must never affect the request path that produced the event.
   */
  publish(organizationId: string, topic: string, event: RealtimeEvent): void {
    const channel = this.channel(organizationId, topic);
    const envelope = {
      ...event,
      tenant: organizationId,
      publishedAt: new Date().toISOString(),
    };
    void this.client.publish(channel, JSON.stringify(envelope)).catch((err: unknown) => {
      this.logger.error(
        { channel, err: err instanceof Error ? err.message : String(err) },
        'realtime publish failed',
      );
    });
  }

  /**
   * Returns a private subscriber connection the caller is responsible for
   * closing (see SSE controllers). Independent of the shared publishing client
   * so subscription back-pressure never blocks callers.
   */
  subscriber(): Redis {
    return this.client.duplicate({ lazyConnect: false });
  }
}