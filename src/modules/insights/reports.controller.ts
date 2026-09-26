import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ReportsService } from './reports.service';
import {
  ExportReportDto,
  ReportExportsListQueryDto,
} from './dto/insights.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('export')
  @ApiEndpoint({
    summary: 'Generate a report export (JSON/CSV/PDF) synchronously with a 24h expiry',
    operationId: 'reportsExport',
    permissions: [PERMISSION_GROUPS.reports.read],
    statusCode: 201,
    errors: [
      { status: 422, description: 'Invalid report type/format or window' },
    ],
  })
  export(@Body() body: ExportReportDto) {
    return this.reports.exportReport(body);
  }

  @Get('exports')
  @ApiEndpoint({
    summary: 'List report exports',
    operationId: 'reportsExportsList',
    permissions: [PERMISSION_GROUPS.reports.read],
  })
  list(@Query() query: ReportExportsListQueryDto) {
    return this.reports.list(query);
  }

  @Get('exports/:id')
  @ApiEndpoint({
    summary: 'Get one report export',
    operationId: 'reportsExportsGet',
    permissions: [PERMISSION_GROUPS.reports.read],
    errors: [{ status: 404, description: 'Report export not found' }],
  })
  get(@Param('id') id: string) {
    return this.reports.get(id);
  }

  @Get('exports/:id/download')
  @ApiEndpoint({
    summary: 'Download the export artifact (inline JSON) before expiry',
    operationId: 'reportsExportsDownload',
    permissions: [PERMISSION_GROUPS.reports.read],
    errors: [
      { status: 404, description: 'Report export not found' },
      { status: 410, description: 'Report has expired' },
    ],
  })
  download(@Param('id') id: string) {
    return this.reports.download(id);
  }
}