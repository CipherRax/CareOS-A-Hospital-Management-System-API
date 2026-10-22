import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { DataExportService } from './data-export.service';
import { DataExportConsumer } from './data-export.consumer';

@Module({
  imports: [StorageModule],
  controllers: [PrivacyController],
  providers: [PrivacyService, DataExportService, DataExportConsumer],
  exports: [PrivacyService, DataExportService],
})
export class PrivacyModule {}
