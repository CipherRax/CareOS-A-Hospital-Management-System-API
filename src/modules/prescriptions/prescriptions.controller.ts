import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { PrescriptionsService } from './prescriptions.service';
import {
  ActionPrescriptionDto,
  CreatePrescriptionDto,
  ListPrescriptionsQueryDto,
  PrescriptionResponseDto,
} from './dto/prescription.dto';

@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a prescription (issues a pharmacy task on issue)',
    operationId: 'prescriptionsCreate',
    permissions: [PERMISSION_GROUPS.prescriptions.create],
    statusCode: 201,
    responseType: PrescriptionResponseDto,
    errors: [
      { status: 400, description: 'At least one line item is required' },
      { status: 404, description: 'Patient, branch or medication not found' },
    ],
  })
  create(@Body() body: CreatePrescriptionDto) {
    return this.prescriptions.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List prescriptions (filters + pagination)',
    operationId: 'prescriptionsList',
    permissions: [PERMISSION_GROUPS.prescriptions.read],
    responseType: ListPrescriptionsQueryDto,
  })
  list(@Query() query: ListPrescriptionsQueryDto) {
    return this.prescriptions.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a prescription',
    operationId: 'prescriptionsGet',
    permissions: [PERMISSION_GROUPS.prescriptions.read],
    responseType: PrescriptionResponseDto,
    errors: [{ status: 404, description: 'Prescription not found' }],
  })
  get(@Param('id') id: string) {
    return this.prescriptions.get(id);
  }

  @Post(':id/action')
  @ApiEndpoint({
    summary: 'Issue or cancel a prescription',
    operationId: 'prescriptionsAction',
    permissions: [PERMISSION_GROUPS.prescriptions.update],
    statusCode: 201,
    responseType: PrescriptionResponseDto,
    errors: [
      { status: 404, description: 'Prescription not found' },
      { status: 409, description: 'Invalid workflow transition' },
    ],
  })
  action(@Param('id') id: string, @Body() body: ActionPrescriptionDto) {
    return this.prescriptions.action(id, body);
  }
}