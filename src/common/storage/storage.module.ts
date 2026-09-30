import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';

/**
 * Shared object storage.
 *
 * Global because the service is stateless apart from an S3 client built once
 * from env, and because more than one feature now needs it: documents upload
 * and download through presigned URLs, and report exports write and stream a
 * server-rendered artifact (patch P11). Declaring it per-feature would create
 * several instances of the same client for no benefit and leave the next
 * storage concern to be added in several places.
 */
@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class StorageModule {}
