import { Controller, Get, Injectable } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { REDIS_CLIENT } from '../../database/redis.module';
import { Public } from '../../common/decorators/public.decorator';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.unscoped().$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (err) {
      return this.getStatus(key, false, {
        error: err instanceof Error ? err.message : 'database unreachable',
      });
    }
  }
}

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      return this.getStatus(key, pong === 'PONG');
    } catch (err) {
      return this.getStatus(key, false, {
        error: err instanceof Error ? err.message : 'redis unreachable',
      });
    }
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiEndpoint({ summary: 'Basic liveness (no dependency checks)', public: true })
  basic(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('live')
  @Public()
  @ApiEndpoint({ summary: 'Liveness: process is up', public: true })
  live(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @Public()
  @HealthCheck()
  @ApiEndpoint({
    summary: 'Readiness: PostgreSQL and Redis reachable',
    description: 'Returns 200 when both Postgres and Redis respond; 503 otherwise.',
    public: true,
  })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
