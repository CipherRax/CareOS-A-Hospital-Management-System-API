import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/config.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

/**
 * Phase 0 test pipeline module. Provided only when not in production — it
 * exists to exercise the transactional outbox/audit/idempotency machinery and
 * must never ship as production surface area.
 */
@Module({
  controllers: [DemoController],
  providers: [
    DemoService,
    {
      provide: 'DEMO_ENABLED',
      inject: [ENV],
      useFactory: (env: Env) => env.NODE_ENV !== 'production',
    },
  ],
  exports: [DemoService],
})
export class DemoModule {}
