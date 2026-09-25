import { Module } from '@nestjs/common';
import { DocumentJobsController } from './document-jobs.controller';
import { DocumentJobsService } from './document-jobs.service';

@Module({
  controllers: [DocumentJobsController],
  providers: [DocumentJobsService],
})
export class DocumentJobsModule {}
