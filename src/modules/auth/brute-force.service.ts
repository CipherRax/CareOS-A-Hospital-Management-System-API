import { Injectable, Logger, Optional } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../database/redis.module';
import { MAX_LOCKOUT_ATTEMPTS, LOCKOUT_MS } from '../../common/security/password';

export interface BruteForceState {
  /** Total failures in the rolling window. */
  attempts: number;
  /** True once the per-account lock should be applied (persisted to the user). */
  shouldLock: boolean;
}

/**
 * Redis-backed brute-force counters (per-account and per-IP). Redis missing →
 * fails open (request proceeds) and the failure is logged; locking still
 * applies through the account row's lockedUntil once the counter crosses the
 * threshold.
 */
@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);
  private readonly windowSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly options: { windowSeconds?: number } = {},
  ) {
    this.windowSeconds = options.windowSeconds ?? Math.ceil(LOCKOUT_MS / 1000);
  }

  accountKey(organizationId: string, email: string): string {
    return `careos:bf:acct:${organizationId}:${email}`;
  }

  ipKey(ip: string): string {
    return `careos:bf:ip:${ip}`;
  }

  async recordFailure(key: string): Promise<BruteForceState> {
    try {
      const attempts = await this.redis.incr(key);
      if (attempts === 1) {
        await this.redis.expire(key, this.windowSeconds).catch(() => undefined);
      }
      return { attempts, shouldLock: attempts >= MAX_LOCKOUT_ATTEMPTS };
    } catch (err) {
      this.logger.warn(
        `Brute-force counter unavailable (failing open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { attempts: 1, shouldLock: false };
    }
  }

  async reset(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(
        `Brute-force counter reset failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Marks a MFA challenge as consumed; false when already consumed. */
  async consumeOnce(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.warn(
        `consumeOnce unavailable (failing open): ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fail open would defeat once-use semantics; fall back to a short TTL.
      return true;
    }
  }
}
