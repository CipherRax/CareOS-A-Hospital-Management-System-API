import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DashboardsService } from './dashboards.service';
import {
  DashboardParamsDto,
  DashboardQueryDto,
} from './dto/insights.dto';

@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get(':role')
  @ApiEndpoint({
    summary: 'Role-fitted dashboard widgets (admin/doctor/nurse/pharmacy/laboratory/accountant)',
    operationId: 'dashboardsByRole',
    permissions: [PERMISSION_GROUPS.analytics.read],
    errors: [
      { status: 422, description: 'Unknown role or invalid window' },
    ],
  })
  byRole(@Param() params: DashboardParamsDto, @Query() query: DashboardQueryDto) {
    return this.dashboards.dashboard(params.role, query);
  }
}