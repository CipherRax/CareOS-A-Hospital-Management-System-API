import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import type { Env } from '../config/config.module';
import { ENV } from '../config/config.module';
import { RealtimeService } from './realtime.service';
import { REDIS_CLIENT } from './redis.tokens';
export { REDIS_CLIENT };

@Injectable()
export class RedisFactory {
  create(env: Env): Redis {
    const url =
      env.REDIS_URL ?? `redis://${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;
    return new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });
  }
}

/** Closes the shared Redis connection when the application shuts down. */
@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    RedisFactory,
    {
      provide: REDIS_CLIENT,
      inject: [ENV, RedisFactory],
      useFactory: (env: Env, factory: RedisFactory): Redis => factory.create(env),
    },
    RealtimeService,
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT, RealtimeService],
})
export class CacheModule {}

export { Redis };
