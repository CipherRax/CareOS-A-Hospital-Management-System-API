import { Controller, Get, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { AnalyticsService } from './analytics.service';
import {
  SupplierSpendQueryDto,
  WastageReportQueryDto,
} from './dto/analytics.dto';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('procurement/wastage')
  @ApiEndpoint({
    summary: 'Wastage report (inventory write-offs by medication)',
    operationId: 'analyticsWastage',
    permissions: [PERMISSION_GROUPS.analytics.read],
  })
  wastage(@Query() query: WastageReportQueryDto) {
    return this.analytics.wastageReport(query);
  }

  @Get('procurement/supplier-spend')
  @ApiEndpoint({
    summary: 'Supplier spend (approved/paid expenses by supplier)',
    operationId: 'analyticsSupplierSpend',
    permissions: [PERMISSION_GROUPS.analytics.read],
  })
  supplierSpend(@Query() query: SupplierSpendQueryDto) {
    return this.analytics.supplierSpend(query);
  }

  @Get('procurement/supplier-balances')
  @ApiEndpoint({
    summary: 'Outstanding supplier balances (unpaid approved expenses)',
    operationId: 'analyticsSupplierBalances',
    permissions: [PERMISSION_GROUPS.analytics.read],
  })
  supplierBalances() {
    return this.analytics.supplierBalances();
  }

  @Get('procurement/purchases')
  @ApiEndpoint({
    summary: 'Recent medication purchases (approved/paid supplies expenses)',
    operationId: 'analyticsProcurement',
    permissions: [PERMISSION_GROUPS.analytics.read],
  })
  procurement(@Query() query: SupplierSpendQueryDto) {
    return this.analytics.procurement(query);
  }
}