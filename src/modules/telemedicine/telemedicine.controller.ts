import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TenantContext } from '../../database/tenant-context';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { TelemedicineService } from './telemedicine.service';
import {
  CancelVirtualSessionDto,
  ListVirtualSessionsQueryDto,
  ScheduleVirtualSessionDto,
  VirtualSessionListResponseDto,
  VirtualSessionResponseDto,
} from './dto/virtual-session.dto';

@Controller('telemedicine')
export class TelemedicineController {
  constructor(
    private readonly telemedicine: TelemedicineService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('sessions')
  @ApiEndpoint({
    summary: 'Schedule a telemedicine session',
    operationId: 'telemedicineScheduleSession',
    permissions: [PERMISSION_GROUPS.telemedicine.manage],
    statusCode: 201,
    responseType: VirtualSessionResponseDto,
    errors: [
      { status: 404, description: 'Branch, patient, provider, or appointment not found' },
      { status: 409, description: 'Patient telemedicine consent is required' },
    ],
  })
  schedule(@Body() body: ScheduleVirtualSessionDto) {
    return this.telemedicine.schedule(body);
  }

  @Get('sessions')
  @ApiEndpoint({
    summary: 'List telemedicine sessions',
    operationId: 'telemedicineListSessions',
    permissions: [PERMISSION_GROUPS.telemedicine.read],
    responseType: VirtualSessionListResponseDto,
  })
  list(@Query() query: ListVirtualSessionsQueryDto) {
    return this.telemedicine.list(query);
  }

  @Get('sessions/:id')
  @ApiEndpoint({
    summary: 'Get a telemedicine session',
    operationId: 'telemedicineGetSession',
    permissions: [PERMISSION_GROUPS.telemedicine.read],
    responseType: VirtualSessionResponseDto,
  })
  get(@Param('id') id: string) {
    return this.telemedicine.get(id);
  }

  @Patch('sessions/:id/start')
  @ApiEndpoint({
    summary: 'Start a telemedicine session',
    operationId: 'telemedicineStartSession',
    permissions: [PERMISSION_GROUPS.telemedicine.manage],
    responseType: VirtualSessionResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition or consent missing' },
    ],
  })
  start(@Param('id') id: string) {
    return this.telemedicine.start(id, this.tenantContext.requireUserId());
  }

  @Patch('sessions/:id/end')
  @ApiEndpoint({
    summary: 'End a telemedicine session',
    operationId: 'telemedicineEndSession',
    permissions: [PERMISSION_GROUPS.telemedicine.manage],
    responseType: VirtualSessionResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  end(@Param('id') id: string) {
    return this.telemedicine.end(id);
  }

  @Patch('sessions/:id/cancel')
  @ApiEndpoint({
    summary: 'Cancel a telemedicine session',
    operationId: 'telemedicineCancelSession',
    permissions: [PERMISSION_GROUPS.telemedicine.manage],
    responseType: VirtualSessionResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  cancel(@Param('id') id: string, @Body() body: CancelVirtualSessionDto) {
    return this.telemedicine.cancel(id, body);
  }
}
