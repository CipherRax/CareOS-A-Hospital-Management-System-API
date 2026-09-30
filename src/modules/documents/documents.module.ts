import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentScanConsumer } from './document-scan.consumer';
import {
  DOCUMENT_SCANNER,
  defaultDocumentScanner,
} from '../../integrations/documents/document-scanner';
import { ENV } from '../../config/config.module';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentScanConsumer,
    {
      // Resolved once at startup from env, so the scanner is swappable without
      // touching the consumer and the consumer has no branch on deployment
      // shape. With no ClamAV host configured this is the in-process heuristic
      // scanner — a real check, not a pass-through.
      provide: DOCUMENT_SCANNER,
      inject: [ENV],
      useFactory: defaultDocumentScanner,
    },
  ],
  // Exported so the outbox dispatcher can reach the consumer without
  // DocumentsModule importing OutboxModule (which would be a cycle).
  exports: [DocumentScanConsumer, DocumentsService],
})
export class DocumentsModule {}
