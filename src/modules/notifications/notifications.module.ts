import { Module } from '@nestjs/common';
import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { NotificationConsumer } from './notifications.consumer';
import { NotificationDeliveryService } from './notifications-delivery.service';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notifications.service';

@Module({
  imports: [NotificationsIntegrationModule],
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationDeliveryService, NotificationConsumer],
  exports: [NotificationConsumer, NotificationService, NotificationDeliveryService],
})
export class NotificationsModule {}
