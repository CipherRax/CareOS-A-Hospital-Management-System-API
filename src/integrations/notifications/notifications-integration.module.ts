import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';
import {
  NOTIFICATION_PROVIDERS,
  defaultProviders,
} from './notifications.provider';

/**
 * Off-system notification delivery wiring (patch P6, ADR-045).
 *
 * Lives here, not in modules/notifications, so the boundary check treats the
 * adapters as shared infrastructure and the feature module depends only on the
 * token. Provider selection is env-driven, matching the M-PESA seam: a
 * deployment with NOTIFICATION_WEBHOOK_URL set gets the signed webhook adapter
 * for every off-system channel, and one without gets the structural stub.
 */
@Module({
  providers: [
    {
      provide: NOTIFICATION_PROVIDERS,
      inject: [ENV],
      useFactory: (env: Env) => defaultProviders(env),
    },
  ],
  exports: [NOTIFICATION_PROVIDERS],
})
export class NotificationsIntegrationModule {}
