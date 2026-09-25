import { Module } from '@nestjs/common';
import {
  ComplaintsController,
  FeedbackController,
  IncidentsController,
} from './quality.controller';
import { ComplaintsService } from './complaints.service';
import { FeedbackService } from './feedback.service';
import { IncidentsService } from './incidents.service';

@Module({
  controllers: [FeedbackController, ComplaintsController, IncidentsController],
  providers: [FeedbackService, ComplaintsService, IncidentsService],
  exports: [FeedbackService],
})
export class QualityModule {}