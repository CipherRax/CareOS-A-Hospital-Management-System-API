import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  controllers: [
    ExpensesController,
    AssetsController,
    MaintenanceController,
    AnalyticsController,
  ],
  providers: [
    ExpensesService,
    AssetsService,
    MaintenanceService,
    AnalyticsService,
  ],
})
export class OperationsModule {}