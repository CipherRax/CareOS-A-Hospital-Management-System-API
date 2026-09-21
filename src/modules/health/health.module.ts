import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import {
  HealthController,
  DatabaseHealthIndicator,
  RedisHealthIndicator,
} from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
