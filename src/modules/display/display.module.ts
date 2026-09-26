import { Module } from '@nestjs/common';
import { AdminDisplayController } from './display.admin.controller';
import { DisplayController } from './display.controller';
import { DisplayQueueController } from './display.queue.controller';
import { DisplayService } from './display.service';

@Module({
  controllers: [DisplayController, AdminDisplayController, DisplayQueueController],
  providers: [DisplayService],
})
export class DisplayModule {}