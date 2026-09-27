import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { Env } from '../../config/config.module';
import { ENV } from '../../config/config.module';
import { FieldEncryption } from '../../common/security/crypto';
import { PublicEmergencyController } from './public-emergency.controller';
import { EmergencyRequestController } from './emergency-request.controller';
import { IntakeSettingsController } from './intake-settings.controller';
import { EmergencyAdminController } from './emergency-admin.controller';
import { EmergencyIntakeService, ESCALATION_QUEUE } from './emergency-intake.service';
import { EmergencyIntakeWorker } from './emergency-escalation.worker';

/**
 * Public emergency intake (brief §6.15). The anonymous surface reads only the
 * PUBLISHED directory projection and cross-tenant reference tables; tenant
 * requests/events are append-only (ADR-040) with caller PII AES-GCM encrypted
 * at rest (ADR-041). Escalation is driven by delayed BullMQ jobs; the
 * processor's guarded updateMany makes every level exactly once. A repeatable
 * maintenance job reconciles lost SLA jobs and applies PII retention
 * (ADR-043), registered only outside NODE_ENV=test.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: { host: env.REDIS_HOST, port: env.REDIS_PORT, db: env.REDIS_DB },
        prefix: env.BULL_PREFIX,
      }),
    }),
    BullModule.registerQueue({ name: ESCALATION_QUEUE }),
  ],
  controllers: [
    PublicEmergencyController,
    EmergencyRequestController,
    IntakeSettingsController,
    EmergencyAdminController,
  ],
  providers: [
    EmergencyIntakeService,
    EmergencyIntakeWorker,
    {
      provide: FieldEncryption,
      useFactory: (env: Env) => new FieldEncryption(env.KEY_ENCRYPTION_SECRET),
      inject: [ENV],
    },
  ],
  exports: [EmergencyIntakeService],
})
export class EmergencyIntakeModule {}