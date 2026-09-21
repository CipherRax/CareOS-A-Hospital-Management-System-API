import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';
import { Inject } from '@nestjs/common';

/** Structurally identical to @nestjs/throttler's ThrottlerStorageRecord. */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed throttler storage using fixed-window counters (atomic INCR +
 * EXPIRE). If Redis is unreachable the storage fails OPEN — rate limiting is a
 * DoS/fraud mitigation, but an outage must not take down clinical/billing flows.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttlSeconds: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const nowSec = Math.floor(Date.now() / 1000);
    const bucketStart = Math.floor(nowSec / ttlSeconds) * ttlSeconds;
    const bucketKey = `throttle:${throttlerName}:${key}:${bucketStart}`;

    try {
      const results = await this.redis
        .multi()
        .incr(bucketKey)
        .expire(bucketKey, ttlSeconds + 30)
        .exec();
      const totalHits = Number(results?.[0]?.[1] ?? 1);
      const timeToExpire = Math.max(0, bucketStart + ttlSeconds - nowSec);

      const isBlocked = totalHits > limit;
      const timeToBlockExpire = isBlocked
        ? Math.max(1, bucketStart + ttlSeconds + blockDuration - nowSec)
        : 0;

      return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
    } catch (err) {
      this.logger.debug(
        { err: String(err), key },
        'rate limiter storage unavailable; allowing request',
      );
      return {
        totalHits: 1,
        timeToExpire: ttlSeconds,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
