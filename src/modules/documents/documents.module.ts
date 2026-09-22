import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ObjectStorageService } from '../../common/storage/object-storage.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, ObjectStorageService],
})
export class DocumentsModule {}