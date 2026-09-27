import { Global, Module } from '@nestjs/common';
import { DirectoryService } from './directory.service';
import { GeoRepository } from './geo/geo.repository';
import {
  FACILITY_DIRECTORY_PROVIDER,
  RemoteCsvFacilityDirectoryProvider,
} from './providers/facility-directory.provider';
import { GEOCODING_PROVIDER, NoopGeocodingProvider } from './providers/geocoding.provider';
import { PublicListingConsumer } from './directory.consumer';
import { PublicDirectoryController } from './public.controller';
import { ListingSettingsController } from './listing.settings.controller';
import { ListingAdminController } from './listing.admin.controller';

/**
 * Public facility directory (brief §6.14). The read model is a cross-tenant
 * sanitized projection (ADR-038); the anonymous surface reads only that table.
 * The org's own surface writes per-branch listing settings and emits
 * `Directory.PublicListingChanged`; the platform surface administers listings
 * and the directory feed directly.
 */
@Global()
@Module({
  controllers: [
    PublicDirectoryController,
    ListingSettingsController,
    ListingAdminController,
  ],
  providers: [
    DirectoryService,
    GeoRepository,
    PublicListingConsumer,
    { provide: FACILITY_DIRECTORY_PROVIDER, useClass: RemoteCsvFacilityDirectoryProvider },
    { provide: GEOCODING_PROVIDER, useClass: NoopGeocodingProvider },
  ],
  exports: [DirectoryService, PublicListingConsumer],
})
export class DirectoryModule {}