import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CodingReferenceConsumer } from './coding.consumer';
import { CodingController } from './coding.controller';
import { CodingService } from './coding.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CodingController],
  providers: [CodingService, CodingReferenceConsumer],
  exports: [CodingReferenceConsumer],
})
export class CodingModule {}
