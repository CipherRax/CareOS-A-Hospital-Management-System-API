import { Module } from '@nestjs/common';
import {
  NOTIFICATION_PROVIDERS,
  defaultProviders,
} from '../../integrations/notifications/notifications.provider';
import { NotificationConsumer } from './notifications.consumer';
import { NotificationDeliveryService } from './notifications-delivery.service';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    NotificationDeliveryService,
    NotificationConsumer,
    {
      provide: NOTIFICATION_PROVIDERS,
      useFactory: defaultProviders,
    },
  ],
  exports: [NotificationConsumer, NotificationService, NotificationDeliveryService],
})
export class NotificationsModule {}
