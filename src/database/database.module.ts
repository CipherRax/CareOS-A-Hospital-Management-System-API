import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { CacheModule, REDIS_CLIENT } from './redis.module';
import { ConfigModule, ENV } from '../config/config.module';
import type { Env } from '../config/config.module';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { PrismaService } from './prisma.service';
import { TenantContext } from './tenant-context';
import { TxRunner } from './tx';
import { AuditService } from './audit.service';
import { OutboxPublisherService } from './outbox-publisher.service';
import { ConsumerOutboxDispatcher } from '../events/outbox-consumer/consumer-outbox-dispatcher';
import { OUTBOX_CONSUMERS } from '../events/outbox-consumer/outbox-consumer.types';
import { TimelineProjectionConsumer } from '../events/consumers/timeline.consumer';
import { PharmacyTaskConsumer } from '../events/consumers/pharmacy-tasks.consumer';
import { OUTBOX_DISPATCHER } from './outbox.tokens';

@Global()
@Module({
  imports: [
    CacheModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: {
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [CacheModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [
          { name: 'default', ttl: 60, limit: 120 },
          { name: 'short', ttl: 5, limit: 30 },
        ],
      }),
    }),
  ],
  providers: [
    TenantContext,
    PrismaService,
    TxRunner,
    AuditService,
    OutboxPublisherService,
    // Registered consumers are fanned out by ConsumerOutboxDispatcher per event
    // type (idempotent via ProcessedEvent). Timeline projection lands first;
    // more consumers register in later phases.
    TimelineProjectionConsumer,
    PharmacyTaskConsumer,
    {
      provide: OUTBOX_CONSUMERS,
      useFactory: (timeline: TimelineProjectionConsumer, pharmacyTasks: PharmacyTaskConsumer) => [
        timeline,
        pharmacyTasks,
      ],
      inject: [TimelineProjectionConsumer, PharmacyTaskConsumer],
    },
    ConsumerOutboxDispatcher,
    { provide: OUTBOX_DISPATCHER, useExisting: ConsumerOutboxDispatcher },
  ],
  exports: [
    CacheModule,
    JwtModule,
    TenantContext,
    PrismaService,
    TxRunner,
    AuditService,
    OutboxPublisherService,
    ThrottlerModule,
  ],
})
export class DatabaseModule {}
