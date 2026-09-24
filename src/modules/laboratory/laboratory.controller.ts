import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { LaboratoryService } from './laboratory.service';
import {
  AcknowledgeCriticalDto,
  AmendResultDto,
  CancelLabOrderDto,
  CreateLabCategoryDto,
  CreateLabOrderDto,
  CreateLabTestDto,
  CriticalResultResponseDto,
  EnterResultsDto,
  LabCategoryResponseDto,
  LabOrderResponseDto,
  LabResultResponseDto,
  LabTestFieldResponseDto,
  LabTestResponseDto,
  ListLabOrdersQueryDto,
  ListLabTestsQueryDto,
  RejectLabOrderDto,
  UpdateLabFieldDto,
  UpdateLabTestDto,
  TatQueryDto,
} from './dto/laboratory.dto';

@Controller()
export class LaboratoryController {
  constructor(private readonly lab: LaboratoryService) {}

  // ─── Catalog: categories ───────────────────────────────────────────────────

  @Post('lab/categories')
  @ApiEndpoint({
    summary: 'Create a lab test category',
    operationId: 'labCategoriesCreate',
    permissions: [PERMISSION_GROUPS.lab.process],
    statusCode: 201,
    responseType: LabCategoryResponseDto,
    errors: [{ status: 409, description: 'A category with this name already exists' }],
  })
  createCategory(@Body() body: CreateLabCategoryDto) {
    return this.lab.createCategory(body);
  }

  @Get('lab/categories')
  @ApiEndpoint({
    summary: 'List lab test categories',
    operationId: 'labCategoriesList',
    permissions: [PERMISSION_GROUPS.lab.read],
    responseType: LabCategoryResponseDto,
  })
  listCategories() {
    return this.lab.listCategories();
  }

  // ─── Catalog: tests + fields ───────────────────────────────────────────────

  @Post('lab/tests')
  @ApiEndpoint({
    summary: 'Create a lab test with its result fields',
    operationId: 'labTestsCreate',
    permissions: [PERMISSION_GROUPS.lab.process],
    statusCode: 201,
    responseType: LabTestResponseDto,
    errors: [
      { status: 409, description: 'A test with this code already exists' },
      { status: 404, description: 'Category not found' },
    ],
  })
  createTest(@Body() body: CreateLabTestDto) {
    return this.lab.createTest(body);
  }

  @Get('lab/tests')
  @ApiEndpoint({
    summary: 'List lab tests (filters + pagination)',
    operationId: 'labTestsList',
    permissions: [PERMISSION_GROUPS.lab.read],
    responseType: ListLabTestsQueryDto,
  })
  listTests(@Query() query: ListLabTestsQueryDto) {
    return this.lab.listTests(query);
  }

  @Patch('lab/tests/:id')
  @ApiEndpoint({
    summary: 'Update a lab test',
    operationId: 'labTestsUpdate',
    permissions: [PERMISSION_GROUPS.lab.process],
    responseType: LabTestResponseDto,
    errors: [
      { status: 404, description: 'Lab test or category not found' },
      { status: 409, description: 'Optimistic lock conflict' },
    ],
  })
  updateTest(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateLabTestDto) {
    return this.lab.updateTest(id, body);
  }

  @Patch('lab/tests/:testId/fields/:fieldId')
  @ApiEndpoint({
    summary: 'Update a lab test result field',
    operationId: 'labTestFieldsUpdate',
    permissions: [PERMISSION_GROUPS.lab.process],
    responseType: LabTestFieldResponseDto,
    errors: [{ status: 404, description: 'Field not found' }],
  })
  updateField(
    @Param('testId', new ParseUUIDPipe()) testId: string,
    @Param('fieldId', new ParseUUIDPipe()) fieldId: string,
    @Body() body: UpdateLabFieldDto,
  ) {
    return this.lab.updateField(testId, fieldId, body);
  }

  // ─── Orders ────────────────────────────────────────────────────────────────

  @Post('lab/orders')
  @ApiEndpoint({
    summary: 'Place a lab order (ORDERED)',
    operationId: 'labOrdersCreate',
    permissions: [PERMISSION_GROUPS.lab.order],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [
      { status: 404, description: 'Branch, patient, source sample or test not found' },
      { status: 400, description: 'Duplicate test, or recollection references a non-rejected sample' },
    ],
  })
  createOrder(@Body() body: CreateLabOrderDto) {
    return this.lab.createOrder(body);
  }

  @Get('lab/orders')
  @ApiEndpoint({
    summary: 'List lab orders (filters + pagination)',
    operationId: 'labOrdersList',
    permissions: [PERMISSION_GROUPS.lab.read],
    responseType: ListLabOrdersQueryDto,
  })
  listOrders(@Query() query: ListLabOrdersQueryDto) {
    return this.lab.listOrders(query);
  }

  @Get('lab/orders/:id')
  @ApiEndpoint({
    summary: 'Get a lab order with its sample, results and amendments',
    operationId: 'labOrdersGet',
    permissions: [PERMISSION_GROUPS.lab.read],
    responseType: LabOrderResponseDto,
    errors: [{ status: 404, description: 'Lab order not found' }],
  })
  getOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.getOrder(id);
  }

  @Post('lab/orders/:id/collect')
  @ApiEndpoint({
    summary: 'Mark the order sample as collected',
    operationId: 'labOrdersCollect',
    permissions: [PERMISSION_GROUPS.lab.collect],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  collectOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.collectOrder(id);
  }

  @Post('lab/orders/:id/receive')
  @ApiEndpoint({
    summary: 'Mark the order sample as received in the lab',
    operationId: 'labOrdersReceive',
    permissions: [PERMISSION_GROUPS.lab.process],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  receiveOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.receiveOrder(id);
  }

  @Post('lab/orders/:id/process')
  @ApiEndpoint({
    summary: 'Start processing the sample',
    operationId: 'labOrdersProcess',
    permissions: [PERMISSION_GROUPS.lab.process],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  processOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.processOrder(id);
  }

  @Post('lab/orders/:id/reject')
  @ApiEndpoint({
    summary: 'Reject a collected/received sample (recollection link)',
    operationId: 'labOrdersReject',
    permissions: [PERMISSION_GROUPS.lab.process],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition' },
      { status: 400, description: 'Only a collected/received sample can be rejected' },
    ],
  })
  rejectOrder(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: RejectLabOrderDto) {
    return this.lab.rejectOrder(id, body);
  }

  @Post('lab/orders/:id/cancel')
  @ApiEndpoint({
    summary: 'Cancel an ordered/collected lab order',
    operationId: 'labOrdersCancel',
    permissions: [PERMISSION_GROUPS.lab.order],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [{ status: 409, description: 'Only ORDERED/COLLECTED orders can be cancelled' }],
  })
  cancelOrder(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: CancelLabOrderDto) {
    return this.lab.cancelOrder(id, body);
  }

  // ─── Results ───────────────────────────────────────────────────────────────

  @Post('lab/orders/:id/results')
  @ApiEndpoint({
    summary: 'Enter results for all fields (PROCESSING → RESULT_READY)',
    operationId: 'labOrdersEnterResults',
    permissions: [PERMISSION_GROUPS.lab.process],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition' },
      { status: 400, description: 'Missing/duplicate/foreign field, or value fails validation' },
    ],
  })
  enterResults(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: EnterResultsDto) {
    return this.lab.enterResults(id, body);
  }

  @Post('lab/orders/:id/verify')
  @ApiEndpoint({
    summary: 'Verify the entered results (RESULT_READY → VERIFIED)',
    operationId: 'labOrdersVerify',
    permissions: [PERMISSION_GROUPS.lab.verify],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition' },
      { status: 400, description: 'Different verifier required (org setting)' },
    ],
  })
  verifyOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.verifyOrder(id);
  }

  @Post('lab/orders/:id/release')
  @ApiEndpoint({
    summary: 'Release verified results to the requester',
    operationId: 'labOrdersRelease',
    permissions: [PERMISSION_GROUPS.lab.release],
    statusCode: 201,
    responseType: LabOrderResponseDto,
    errors: [
      { status: 409, description: 'Not verified or unacknowledged critical results' },
    ],
  })
  releaseOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.releaseOrder(id);
  }

  @Get('lab/results/:id')
  @ApiEndpoint({
    summary: 'Get a result with its amendment trail',
    operationId: 'labResultsGet',
    permissions: [PERMISSION_GROUPS.lab.read],
    responseType: LabResultResponseDto,
    errors: [{ status: 404, description: 'Result not found' }],
  })
  getResult(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.getResult(id);
  }

  @Patch('lab/results/:id')
  @ApiEndpoint({
    summary: 'Amend a result (pre-release: fix v1; post-release: new revision)',
    operationId: 'labResultsAmend',
    permissions: [PERMISSION_GROUPS.lab.process],
    responseType: LabResultResponseDto,
    errors: [
      { status: 404, description: 'Result not found' },
      { status: 400, description: 'Value fails validation' },
    ],
  })
  amendResult(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AmendResultDto) {
    return this.lab.amendResult(id, body);
  }

  @Post('lab/critical/:id/acknowledge')
  @ApiEndpoint({
    summary: 'Acknowledge a critical result (idempotent)',
    operationId: 'labCriticalAcknowledge',
    permissions: [PERMISSION_GROUPS.lab.acknowledge],
    statusCode: 201,
    responseType: CriticalResultResponseDto,
    errors: [{ status: 404, description: 'Critical result not found' }],
  })
  acknowledgeCritical(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AcknowledgeCriticalDto) {
    return this.lab.acknowledgeCritical(id, body);
  }

  @Get('lab/tat')
  @ApiEndpoint({
    summary: 'Turnaround-time statistics for released orders',
    operationId: 'labTat',
    permissions: [PERMISSION_GROUPS.lab.read],
  })
  tat(@Query() query: TatQueryDto) {
    return this.lab.tat(query);
  }
}