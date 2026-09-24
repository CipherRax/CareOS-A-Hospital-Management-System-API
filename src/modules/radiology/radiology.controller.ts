import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { RadiologyService } from './radiology.service';
import {
  CancelRadiologyOrderDto,
  CreateRadiologyOrderDto,
  ListRadiologyOrdersQueryDto,
  RadiologyOrderResponseDto,
  SubmitReportDto,
} from './dto/radiology.dto';

@Controller()
export class RadiologyController {
  constructor(private readonly radiology: RadiologyService) {}

  @Post('radiology/orders')
  @ApiEndpoint({
    summary: 'Place a radiology order (ORDERED)',
    operationId: 'radiologyOrdersCreate',
    permissions: [PERMISSION_GROUPS.radiology.order],
    statusCode: 201,
    responseType: RadiologyOrderResponseDto,
    errors: [{ status: 404, description: 'Branch or patient not found' }],
  })
  createOrder(@Body() body: CreateRadiologyOrderDto) {
    return this.radiology.createOrder(body);
  }

  @Get('radiology/orders')
  @ApiEndpoint({
    summary: 'List radiology orders (filters + pagination)',
    operationId: 'radiologyOrdersList',
    permissions: [PERMISSION_GROUPS.radiology.read],
    responseType: ListRadiologyOrdersQueryDto,
  })
  listOrders(@Query() query: ListRadiologyOrdersQueryDto) {
    return this.radiology.listOrders(query);
  }

  @Get('radiology/orders/:id')
  @ApiEndpoint({
    summary: 'Get a radiology order with its report',
    operationId: 'radiologyOrdersGet',
    permissions: [PERMISSION_GROUPS.radiology.read],
    responseType: RadiologyOrderResponseDto,
    errors: [{ status: 404, description: 'Radiology order not found' }],
  })
  getOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.radiology.getOrder(id);
  }

  @Post('radiology/orders/:id/schedule')
  @ApiEndpoint({
    summary: 'Schedule a radiology order (ORDERED → SCHEDULED)',
    operationId: 'radiologyOrdersSchedule',
    permissions: [PERMISSION_GROUPS.radiology.process],
    statusCode: 201,
    responseType: RadiologyOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  scheduleOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.radiology.scheduleOrder(id);
  }

  @Post('radiology/orders/:id/perform')
  @ApiEndpoint({
    summary: 'Record acquisition (SCHEDULED → PERFORMED)',
    operationId: 'radiologyOrdersPerform',
    permissions: [PERMISSION_GROUPS.radiology.process],
    statusCode: 201,
    responseType: RadiologyOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  performOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.radiology.performOrder(id);
  }

  @Post('radiology/orders/:id/report')
  @ApiEndpoint({
    summary: 'Submit the imaging report (PERFORMED → REPORTED)',
    operationId: 'radiologyOrdersReport',
    permissions: [PERMISSION_GROUPS.radiology.process],
    statusCode: 201,
    responseType: RadiologyOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  submitReport(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: SubmitReportDto) {
    return this.radiology.submitReport(id, body);
  }

  @Post('radiology/orders/:id/verify')
  @ApiEndpoint({
    summary: 'Verify the imaging report (REPORTED → VERIFIED)',
    operationId: 'radiologyOrdersVerify',
    permissions: [PERMISSION_GROUPS.radiology.verify],
    statusCode: 201,
    responseType: RadiologyOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  verifyOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.radiology.verifyOrder(id);
  }

  @Post('radiology/orders/:id/release')
  @ApiEndpoint({
    summary: 'Release the verified report (VERIFIED → RELEASED)',
    operationId: 'radiologyOrdersRelease',
    permissions: [PERMISSION_GROUPS.radiology.release],
    statusCode: 201,
    responseType: RadiologyOrderResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition' },
      { status: 409, description: 'Report not verified' },
    ],
  })
  releaseOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.radiology.releaseOrder(id);
  }

  @Post('radiology/orders/:id/cancel')
  @ApiEndpoint({
    summary: 'Cancel an ordered/scheduled radiology order',
    operationId: 'radiologyOrdersCancel',
    permissions: [PERMISSION_GROUPS.radiology.order],
    statusCode: 201,
    responseType: RadiologyOrderResponseDto,
    errors: [{ status: 409, description: 'Only ORDERED/SCHEDULED orders can be cancelled' }],
  })
  cancelOrder(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: CancelRadiologyOrderDto) {
    return this.radiology.cancelOrder(id, body);
  }
}