import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ENV, type Env } from '../config/config.module';

/**
 * Single place where the BullMQ connection and key prefix are configured.
 *
 * Before P5 each queue-owning module called `BullModule.forRootAsync` itself
 * (ADR-043/P3). That is duplication with a footgun: root options are global, so
 * the last module to boot wins the prefix. Queue *registration* stays with the
 * module that owns the queue (that part is per-queue by design); only the root
 * connection is shared, and it is re-exported globally so every queue module
 * resolves it from here.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { host: env.REDIS_HOST, port: env.REDIS_PORT, db: env.REDIS_DB },
        prefix: env.BULL_PREFIX,
      }),
    }),
  ],
  exports: [BullModule],
})
export class BullQueuesModule {}
