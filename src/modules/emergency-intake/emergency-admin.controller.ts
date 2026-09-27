import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EmergencyIntakeService } from './emergency-intake.service';
import {
  EmergencyNumberUpsertDto,
  PublicNoticeUpsertDto,
} from './dto/emergency-intake.dto';

/**
 * Platform administration of the cross-tenant emergency reference data: the
 * national-number table the anonymous surface publishes and active public
 * notices. `platform.facilities.manage` only.
 */
@Controller('admin/emergency')
export class EmergencyAdminController {
  constructor(private readonly intake: EmergencyIntakeService) {}

  @Get('numbers')
  @ApiEndpoint({
    summary: 'List all reference emergency numbers',
    operationId: 'adminListEmergencyNumbers',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
  })
  numbers() {
    return this.intake.listNumbers();
  }

  @Post('numbers')
  @ApiEndpoint({
    summary: 'Create an emergency number (one per country/purpose)',
    operationId: 'adminSetEmergencyNumber',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    errors: [{ status: 409, description: 'Duplicate country/purpose', code: 'CONFLICT' }],
  })
  setNumber(@Body() body: EmergencyNumberUpsertDto) {
    return this.intake.setNumber(body);
  }

  @Put('numbers/:id')
  @ApiEndpoint({
    summary: 'Update an emergency number',
    operationId: 'adminPatchEmergencyNumber',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    errors: [{ status: 404, description: 'Number not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  patchNumber(@Param('id') id: string, @Body() body: EmergencyNumberUpsertDto) {
    return this.intake.setNumber(body, id);
  }

  @Delete('numbers/:id')
  @ApiEndpoint({
    summary: 'Remove an emergency number',
    operationId: 'adminDeleteEmergencyNumber',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    errors: [{ status: 404, description: 'Number not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  deleteNumber(@Param('id') id: string) {
    return this.intake.deleteNumber(id);
  }

  @Get('notices')
  @ApiEndpoint({
    summary: 'List all public service notices',
    operationId: 'adminListPublicNotices',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
  })
  notices() {
    return this.intake.listNotices();
  }

  @Post('notices')
  @ApiEndpoint({
    summary: 'Create a public service notice',
    operationId: 'adminSetPublicNotice',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
  })
  setNotice(@Body() body: PublicNoticeUpsertDto) {
    return this.intake.setNotice(body);
  }

  @Put('notices/:id')
  @ApiEndpoint({
    summary: 'Update a public service notice',
    operationId: 'adminPatchPublicNotice',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    errors: [{ status: 404, description: 'Notice not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  patchNotice(@Param('id') id: string, @Body() body: PublicNoticeUpsertDto) {
    return this.intake.setNotice(body, id);
  }

  @Delete('notices/:id')
  @ApiEndpoint({
    summary: 'Remove a public service notice',
    operationId: 'adminDeletePublicNotice',
    permissions: [PERMISSION_GROUPS.facilityDirectory.facilitiesManage],
    errors: [{ status: 404, description: 'Notice not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  deleteNotice(@Param('id') id: string) {
    return this.intake.deleteNotice(id);
  }
}