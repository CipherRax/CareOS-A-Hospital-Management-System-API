import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DiagnosesService } from './diagnoses.service';
import {
  CreateDiagnosisDto,
  DenormalizedDiagnosisResponseDto,
  ListDiagnosesQueryDto,
  UpdateDiagnosisDto,
} from './dto/diagnosis.dto';

@Controller('diagnoses')
export class DiagnosesController {
  constructor(private readonly diagnoses: DiagnosesService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Record a diagnosis (coded or free text) against an open encounter',
    operationId: 'diagnosesCreate',
    permissions: [PERMISSION_GROUPS.diagnoses.create],
    statusCode: 201,
    responseType: DenormalizedDiagnosisResponseDto,
    errors: [
      { status: 404, description: 'Encounter or coding concept not found' },
      { status: 409, description: 'Encounter is COMPLETED and locked' },
    ],
  })
  create(@Body() body: CreateDiagnosisDto) {
    return this.diagnoses.create(body);
  }

  @Get('problems')
  @ApiEndpoint({
    summary: 'Active problem list for a patient',
    operationId: 'diagnosesProblems',
    permissions: [PERMISSION_GROUPS.diagnoses.read],
    responseType: DenormalizedDiagnosisResponseDto,
  })
  problems(@Query('patientId') patientId: string) {
    return this.diagnoses.problems(patientId);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List diagnoses (filters + pagination)',
    operationId: 'diagnosesList',
    permissions: [PERMISSION_GROUPS.diagnoses.read],
    responseType: ListDiagnosesQueryDto,
  })
  list(@Query() query: ListDiagnosesQueryDto) {
    return this.diagnoses.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a diagnosis',
    operationId: 'diagnosesGet',
    permissions: [PERMISSION_GROUPS.diagnoses.read],
    responseType: DenormalizedDiagnosisResponseDto,
  })
  get(@Param('id') id: string) {
    return this.diagnoses.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a diagnosis (resolve, or re-classify while ACTIVE)',
    operationId: 'diagnosesUpdate',
    permissions: [PERMISSION_GROUPS.diagnoses.update],
    responseType: DenormalizedDiagnosisResponseDto,
    errors: [{ status: 409, description: 'Only ACTIVE diagnoses can be updated' }],
  })
  update(@Param('id') id: string, @Body() body: UpdateDiagnosisDto) {
    return this.diagnoses.update(id, body);
  }
}