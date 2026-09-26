import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DisplayService } from './display.service';
import {
  ListDisplayDevicesQueryDto,
  RegisterDisplayDeviceDto,
  UpdateDisplayDeviceDto,
} from './dto/display.dto';

/**
 * Admin surface for waiting-room displays (brief §5.16 contract path
 * `/admin/display-devices`). Thin alias over the display service so staff tooling
 * and the device pairing UI (which historically live under `/display/devices`)
 * both keep working; the shared service is the single implementation.
 */
@Controller('admin/display-devices')
export class AdminDisplayController {
  constructor(private readonly display: DisplayService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a waiting-room display device (returns a one-time pairing code)',
    operationId: 'displayAdminCreateDevice',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    statusCode: 201,
    responseType: RegisterDisplayDeviceDto,
  })
  create(@Body() body: RegisterDisplayDeviceDto) {
    return this.display.register(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List display devices',
    operationId: 'displayAdminListDevices',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    responseType: ListDisplayDevicesQueryDto,
  })
  list(@Query() query: ListDisplayDevicesQueryDto) {
    return this.display.list(query);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a display device (name / branch / departments)',
    operationId: 'displayAdminUpdateDevice',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    responseType: UpdateDisplayDeviceDto,
  })
  update(@Param('id') id: string, @Body() body: UpdateDisplayDeviceDto) {
    return this.display.update(id, body);
  }

  @Post(':id/rescan')
  @ApiEndpoint({
    summary: 'Start a re-pair (new code; the current token is killed at once)',
    operationId: 'displayAdminRescanDevice',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    statusCode: 201,
    responseType: RegisterDisplayDeviceDto,
  })
  rescan(@Param('id') id: string) {
    return this.display.rescan(id);
  }

  @Post(':id/revoke')
  @ApiEndpoint({
    summary: 'Revoke a display device (kills its token immediately)',
    operationId: 'displayAdminRevokeDevice',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    statusCode: 201,
    responseType: UpdateDisplayDeviceDto,
  })
  revoke(@Param('id') id: string) {
    return this.display.revoke(id);
  }

  @Post(':id/rotate-token')
  @ApiEndpoint({
    summary: 'Rotate a device token (the old one stops working at once)',
    operationId: 'displayAdminRotateDeviceToken',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    statusCode: 201,
    responseType: UpdateDisplayDeviceDto,
  })
  rotateToken(@Param('id') id: string) {
    return this.display.rotateToken(id);
  }
}