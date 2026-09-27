import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DirectoryService } from './directory.service';
import { ListListingsQueryDto, UpdateListingBodyDto } from './dto/directory.dto';

/**
 * Facility-directory administration (brief §6.14).
 *
 * Two surfaces, two permission boundaries:
 *  - `public_listing.manage`: the org's OWN listings (publish, mine, staging an
 *    imported source row into this org).
 *  - `platform.facilities.manage`: cross-tenant operator controls (suspend,
 *    confirm, direct corrections, feed import sync, global listing audit).
 */
@Controller('admin/listings')
export class ListingAdminController {
  constructor(private readonly directory: DirectoryService) {}

  // --- own-org surface ------------------------------------------------------

  @Post('publish')
  @ApiEndpoint({
    summary: 'Publish this branch into the public directory (PUBLISHED)',
    operationId: 'directoryPublish',
    permissions: [PERMISSION_GROUPS.publicListing.manage],
  })
  publish() {
    return this.directory.publish();
  }

  @Get('mine')
  @ApiEndpoint({
    summary: 'This organization\'s own directory listings',
    operationId: 'directoryMyListings',
    permissions: [PERMISSION_GROUPS.publicListing.manage],
  })
  mine(@Query() query: ListListingsQueryDto) {
    return this.directory.myListings(query);
  }

  @Post('import/run')
  @ApiEndpoint({
    summary: 'Synchronize all rows from the facility-directory feed',
    operationId: 'directoryImportRun',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    statusCode: 201,
    errors: [{ status: 503, description: 'Feed unavailable', code: 'DIRECTORY_SOURCE_UNAVAILABLE' }],
  })
  importRun() {
    return this.directory.importRun();
  }

  @Post('import/:sourceId')
  @ApiEndpoint({
    summary: 'Stage an imported directory row into this org\'s DRAFT listing pool',
    operationId: 'directoryImportOne',
    permissions: [PERMISSION_GROUPS.publicListing.manage],
    statusCode: 201,
    errors: [
      { status: 404, description: 'Imported source row not found' },
      { status: 409, description: 'Already staged', code: 'CONFLICT' },
    ],
  })
  importOne(@Param('sourceId') sourceId: string) {
    return this.directory.importOne(sourceId);
  }

  // --- platform surface ------------------------------------------------------

  @Get()
  @ApiEndpoint({
    summary: 'Cross-tenant listing audit (platform)',
    operationId: 'directoryListAll',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
  })
  list(@Query() query: ListListingsQueryDto) {
    return this.directory.listAll(query);
  }

  @Post(':id/suspend')
  @ApiEndpoint({
    summary: 'Suspend a listing platform-wide (hidden from public)',
    operationId: 'directorySuspend',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    statusCode: 201,
  })
  suspend(@Param('id') id: string) {
    return this.directory.setStatus(id, 'SUSPENDED', 'directory.listing_suspended');
  }

  @Post(':id/unsuspend')
  @ApiEndpoint({
    summary: 'Restore a suspended listing',
    operationId: 'directoryUnsuspend',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    statusCode: 201,
  })
  unsuspend(@Param('id') id: string) {
    return this.directory.setStatus(id, 'PUBLISHED', 'directory.listing_unsuspended');
  }

  @Post(':id/confirm')
  @ApiEndpoint({
    summary: 'Mark a listing\'s details as verified/confirmed',
    operationId: 'directoryConfirm',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    statusCode: 201,
  })
  confirm(@Param('id') id: string) {
    return this.directory.confirmListing(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Directly correct listing fields (platform override)',
    operationId: 'directoryUpdateListing',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    errors: [{ status: 422, description: 'Invalid coordinates', code: 'INVALID_COORDINATES' }],
  })
  update(@Param('id') id: string, @Body() body: UpdateListingBodyDto) {
    return this.directory.updateListing(id, body);
  }

  @Get('imported')
  @ApiEndpoint({
    summary: 'Imported directory source rows',
    operationId: 'directoryListImported',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
  })
  imported(@Query() query: ListListingsQueryDto) {
    return this.directory.listImported(query);
  }
}