import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DirectoryService } from './directory.service';
import { UpdateListingSettingsDto } from './dto/directory.dto';

/**
 * Per-branch public-directory listing settings (brief §6.14). Settings are
 * tenant-owned (OrganizationSetting); only the published projection is public.
 */
@Controller('settings/listing')
export class ListingSettingsController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Current public-directory listing settings for this branch',
    operationId: 'getListingSettings',
    permissions: [PERMISSION_GROUPS.publicListing.manage],
  })
  get() {
    return this.directory.settingsOf();
  }

  @Put()
  @ApiEndpoint({
    summary: 'Update the public-directory listing settings for this branch',
    operationId: 'updateListingSettings',
    permissions: [PERMISSION_GROUPS.publicListing.manage],
    errors: [{ status: 422, description: 'Invalid coordinates', code: 'INVALID_COORDINATES' }],
  })
  update(@Body() body: UpdateListingSettingsDto) {
    return this.directory.updateSettings(body);
  }
}