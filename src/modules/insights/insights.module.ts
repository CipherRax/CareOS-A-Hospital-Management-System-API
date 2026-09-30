import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { BottleneckService } from './bottleneck.service';
import { CapacityService } from './capacity.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';
import { ForecastsService } from './forecasts.service';
import { MetricsService } from './metrics.service';
import { PatientExperienceService } from './patient-experience.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { ReportExportConsumer } from './report-export.consumer';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { RollupTouchConsumer } from './rollups.consumer';
import { RollupsService } from './rollups.service';
import { StaffAnalyticsService } from './staff-analytics.service';

@Module({
  controllers: [
    AnalyticsController,
    DashboardsController,
    ReportsController,
    ReconciliationController,
  ],
  providers: [
    MetricsService,
    RollupsService,
    RollupTouchConsumer,
    BottleneckService,
    CapacityService,
    ForecastsService,
    PatientExperienceService,
    StaffAnalyticsService,
    DashboardsService,
    ReportsService,
    ReportExportConsumer,
    ReconciliationService,
  ],
  // ReportsService is exported so the scheduler's export-expiry duty can remove
  // a stored artifact without the duty reaching into this module's tables.
  exports: [RollupsService, RollupTouchConsumer, ForecastsService, ReportsService, ReportExportConsumer],
})
export class InsightsModule {}