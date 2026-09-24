import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { MedicationsService } from './medications.service';
import {
  CreateMedicationDto,
  ListMedicationsQueryDto,
  MedicationResponseDto,
  UpdateMedicationDto,
} from './dto/medication.dto';

@Controller('medications')
export class MedicationsController {
  constructor(private readonly medications: MedicationsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Add a medication or supply to the catalog',
    operationId: 'medicationsCreate',
    permissions: [PERMISSION_GROUPS.medications.manage],
    statusCode: 201,
    responseType: MedicationResponseDto,
    errors: [{ status: 409, description: 'Duplicate catalog identity for this organization' }],
  })
  create(@Body() body: CreateMedicationDto) {
    return this.medications.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List the catalog (search, category, filters + pagination)',
    operationId: 'medicationsList',
    permissions: [PERMISSION_GROUPS.medications.read],
    responseType: ListMedicationsQueryDto,
  })
  list(@Query() query: ListMedicationsQueryDto) {
    return this.medications.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one catalog item',
    operationId: 'medicationsGet',
    permissions: [PERMISSION_GROUPS.medications.read],
    responseType: MedicationResponseDto,
    errors: [{ status: 404, description: 'Medication not found' }],
  })
  get(@Param('id') id: string) {
    return this.medications.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a catalog item (optimistic lock on version)',
    operationId: 'medicationsUpdate',
    permissions: [PERMISSION_GROUPS.medications.manage],
    responseType: MedicationResponseDto,
    errors: [
      { status: 404, description: 'Medication not found' },
      { status: 409, description: 'Version conflict or duplicate identity' },
    ],
  })
  update(@Param('id') id: string, @Body() body: UpdateMedicationDto) {
    return this.medications.update(id, body);
  }
}