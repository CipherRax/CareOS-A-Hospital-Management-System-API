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
import { TimelineProjectionConsumer } from '../events/consumers/timeline.consumer';
import { PharmacyTaskConsumer } from '../events/consumers/pharmacy-tasks.consumer';

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
        // `default`/`short` apply to every authenticated route. The named
        // throttlers below exist so the anonymous/public surfaces and the
        // device/display surfaces can carry limits appropriate to their risk
        // (brief §5.16, §6.14, §6.15) instead of inheriting the staff-wide
        // budget. A route opts in with `@Throttle({ publicSearch: {...} })`.
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 120 },
          { name: 'short', ttl: 5_000, limit: 30 },
          // Directory search/browse: read-only and cacheable, but must not be
          // scrapeable into an exhaustive dump.
          { name: 'publicSearch', ttl: 60_000, limit: 60 },
          // Reverse geocoding: costlier per call (provider quota) and a common
          // abuse target for coordinate fuzzing.
          { name: 'publicGeocode', ttl: 60_000, limit: 30 },
          // Anonymous emergency submit. Deliberately tight: a duplicate submit
          // is a real safety problem (split response), and the response always
          // carries EMERGENCY_CALL_NOW + national numbers (429 body).
          { name: 'publicEmergencySubmit', ttl: 60_000, limit: 5 },
          // Token tracking/cancel: caller-facing polling, so looser than submit
          // but still bounded.
          { name: 'publicEmergencyTrack', ttl: 60_000, limit: 30 },
          // Device pairing: exchanges a staff-read one-time code for a long-lived
          // token, so it is additionally IP-attempt-limited in DisplayService.
          { name: 'displayPair', ttl: 60_000, limit: 10 },
          // Public onboarding enquiry (public lead capture).
          { name: 'onboardingInquiry', ttl: 60_000, limit: 5 },
        ],
      }),
    }),
  ],
  providers: [
    TenantContext,
    PrismaService,
    TxRunner,
    AuditService,
    TimelineProjectionConsumer,
    PharmacyTaskConsumer,
  ],
  exports: [
    CacheModule,
    JwtModule,
    TenantContext,
    PrismaService,
    TxRunner,
    AuditService,
    ThrottlerModule,
    TimelineProjectionConsumer,
    PharmacyTaskConsumer,
  ],
})
export class DatabaseModule {}
