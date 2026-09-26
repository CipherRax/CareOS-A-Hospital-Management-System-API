import { Controller, Get, Param, Post, Body, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { MetricsService } from './metrics.service';
import { BottleneckService } from './bottleneck.service';
import { CapacityService } from './capacity.service';
import { ForecastsService } from './forecasts.service';
import { PatientExperienceService } from './patient-experience.service';
import { StaffAnalyticsService } from './staff-analytics.service';
import { RollupsService } from './rollups.service';
import {
  BottleneckQueryDto,
  CapacityQueryDto,
  MetricsQueryDto,
  ForecastQueryDto,
  ForecastSeriesSchema,
} from './dto/insights.dto';
import { StaffAnalyticsQueryDto } from './dto/insights.dto';
import { WindowQueryDto, RebuildRollupsDto } from './dto/insights.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly bottleneck: BottleneckService,
    private readonly capacity: CapacityService,
    private readonly forecasts: ForecastsService,
    private readonly patientExperience: PatientExperienceService,
    private readonly staffAnalytics: StaffAnalyticsService,
    private readonly rollups: RollupsService,
  ) {}

  @Get('metrics')
  @ApiEndpoint({
    summary: 'Operational metrics over the window (rollup + snapshot)',
    operationId: 'analyticsMetrics',
    permissions: [PERMISSION_GROUPS.analytics.read],
    errors: [
      { status: 422, description: 'Invalid window (from after to)' },
    ],
  })
  getMetrics(@Query() query: MetricsQueryDto) {
    return this.metrics.metrics(query);
  }

  @Get('bottleneck')
  @ApiEndpoint({
    summary: 'Ranked bottleneck stages (descriptive averages, no causal claims)',
    operationId: 'analyticsBottleneck',
    permissions: [PERMISSION_GROUPS.analytics.read],
    errors: [
      { status: 422, description: 'Invalid window' },
    ],
  })
  getBottleneck(@Query() query: BottleneckQueryDto) {
    return this.bottleneck.analyze(query);
  }

  @Get('capacity')
  @ApiEndpoint({
    summary: 'Capacity view: peak hours/days, department load, provider booking fill, bed occupancy',
    operationId: 'analyticsCapacity',
    permissions: [PERMISSION_GROUPS.analytics.read],
    errors: [
      { status: 422, description: 'Invalid window' },
    ],
  })
  getCapacity(@Query() query: CapacityQueryDto) {
    return this.capacity.capacity(query);
  }

  @Get('patient-experience')
  @ApiEndpoint({
    summary: 'Configurable weighted patient-experience composite',
    operationId: 'analyticsPatientExperience',
    permissions: [PERMISSION_GROUPS.analytics.read],
    errors: [
      { status: 422, description: 'Invalid window' },
    ],
  })
  getExperience(@Query() query: WindowQueryDto) {
    return this.patientExperience.score(query);
  }

  @Get('staff')
  @ApiEndpoint({
    summary: 'Staff analytics (raw measurements; not for individual employment decisions)',
    operationId: 'analyticsStaff',
    permissions: [PERMISSION_GROUPS.analytics.read],
    errors: [
      { status: 422, description: 'Invalid window' },
    ],
  })
  getStaff(@Query() query: StaffAnalyticsQueryDto) {
    return this.staffAnalytics.staff(query);
  }

  @Get('forecasts/:series')
  @ApiEndpoint({
    summary: 'Labelled forecast (model + version + period + uncertainty) for one series',
    operationId: 'analyticsForecastSeries',
    permissions: [PERMISSION_GROUPS.analytics.read],
    errors: [
      { status: 422, description: 'Unknown series or invalid window' },
    ],
  })
  getForecast(@Param('series') series: string, @Query() query: ForecastQueryDto) {
    const parsed = ForecastSeriesSchema.safeParse(series);
    if (!parsed.success) {
      return this.forecasts.unknownSeries(series, query);
    }
    return this.forecasts.bySeries(parsed.data, query);
  }

  @Post('rollups/rebuild')
  @ApiEndpoint({
    summary: 'Recompute the daily rollup for a window (backfill / repair)',
    operationId: 'analyticsRollupsRebuild',
    permissions: [PERMISSION_GROUPS.analytics.read],
    statusCode: 201,
    errors: [
      { status: 422, description: 'Invalid window' },
    ],
  })
  rebuild(@Body() body: RebuildRollupsDto) {
    return this.rollups.rebuildWindow(body);
  }
}