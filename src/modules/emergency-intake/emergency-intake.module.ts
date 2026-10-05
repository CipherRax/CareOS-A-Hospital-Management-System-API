import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { Env } from '../../config/config.module';
import { ENV } from '../../config/config.module';
import { FieldEncryption } from '../../common/security/crypto';
import { BullQueuesModule } from '../../jobs/bull-queues.module';
import { PublicEmergencyController } from './public-emergency.controller';
import { PublicEmergencyRequestsController } from './public-emergency-requests.controller';
import { EmergencyRequestController } from './emergency-request.controller';
import { IntakeSettingsController } from './intake-settings.controller';
import { EmergencyAdminController } from './emergency-admin.controller';
import { EmergencyIntakeService, ESCALATION_QUEUE } from './emergency-intake.service';
import { EmergencyIntakeWorker } from './emergency-escalation.worker';
import { EmergencyNotificationConsumer } from './emergency-notifications.consumer';
import { EmergencyRateLimitFilter } from './emergency-rate-limit.filter';
import { NotificationsModule } from '../notifications/notifications.module';

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
    BullQueuesModule,
    BullModule.registerQueue({ name: ESCALATION_QUEUE }),
    NotificationsModule,
  ],
  controllers: [
    PublicEmergencyController,
    PublicEmergencyRequestsController,
    EmergencyRequestController,
    IntakeSettingsController,
    EmergencyAdminController,
  ],
  providers: [
    EmergencyIntakeService,
    EmergencyIntakeWorker,
    // Pages on-call contacts when a request arrives or escalates. Bodies are
    // reference-only so no caller PHI reaches an SMS/email channel.
    EmergencyNotificationConsumer,
    // Turns a 429 on the anonymous surface into EMERGENCY_CALL_NOW + numbers.
    EmergencyRateLimitFilter,
    {
      provide: FieldEncryption,
      useFactory: (env: Env) => new FieldEncryption(env.KEY_ENCRYPTION_SECRET),
      inject: [ENV],
    },
  ],
  // EmergencyNotificationConsumer must be exported, not just provided:
  // OutboxModule imports this module and injects the consumer into the
  // OUTBOX_CONSUMERS bus. Without the export, Nest cannot resolve it and the
  // whole application fails to bootstrap.
  exports: [EmergencyIntakeService, EmergencyNotificationConsumer],
})
export class EmergencyIntakeModule {}