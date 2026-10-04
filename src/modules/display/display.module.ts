import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminDisplayController } from './display.admin.controller';
import { DisplayController } from './display.controller';
import { DisplayPairAliasController } from './display-pair-alias.controller';
import { DisplayQueueController } from './display.queue.controller';
import { DisplayService } from './display.service';

@Module({
  imports: [NotificationsModule],
  controllers: [
    DisplayController,
    DisplayPairAliasController,
    AdminDisplayController,
    DisplayQueueController,
  ],
  providers: [DisplayService],
  // The scheduler owns the timer; the sweep itself lives here so the staleness
  // rule stays with the module that owns device liveness.
  exports: [DisplayService],
})
export class DisplayModule {}