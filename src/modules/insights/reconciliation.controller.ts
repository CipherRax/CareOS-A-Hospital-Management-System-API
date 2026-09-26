import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ReconciliationService } from './reconciliation.service';
import {
  ExceptionsQueryDto,
  ExceptionUpdateDto,
  ReconcileRunDto,
} from './dto/insights.dto';

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('run')
  @ApiEndpoint({
    summary: 'Run a billing reconciliation pass (neutral exception records)',
    operationId: 'reconciliationRun',
    permissions: [PERMISSION_GROUPS.reports.read],
    statusCode: 201,
    errors: [
      { status: 422, description: 'Invalid window' },
    ],
  })
  run(@Body() body: ReconcileRunDto) {
    return this.reconciliation.run(body);
  }

  @Get('exceptions')
  @ApiEndpoint({
    summary: 'List reconciliation exceptions (filter by type/severity/status)',
    operationId: 'reconciliationExceptionsList',
    permissions: [PERMISSION_GROUPS.reports.read],
    errors: [
      { status: 422, description: 'Invalid filter' },
    ],
  })
  exceptions(@Query() query: ExceptionsQueryDto) {
    return this.reconciliation.exceptions(query);
  }

  @Patch('exceptions/:id')
  @ApiEndpoint({
    summary: 'Acknowledge or resolve a reconciliation exception',
    operationId: 'reconciliationExceptionsUpdate',
    permissions: [PERMISSION_GROUPS.reports.read],
    errors: [
      { status: 404, description: 'Exception not found' },
      { status: 409, description: 'Invalid state transition' },
    ],
  })
  update(@Param('id') id: string, @Body() body: ExceptionUpdateDto) {
    return this.reconciliation.updateStatus(id, body.status);
  }
}