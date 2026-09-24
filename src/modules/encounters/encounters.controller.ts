import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EncountersService } from './encounters.service';
import {
  CreateEncounterDto,
  EncounterResponseDto,
  ListEncountersQueryDto,
  TransitionEncounterDto,
} from './dto/encounter.dto';

@Controller('encounters')
export class EncountersController {
  constructor(private readonly encounters: EncountersService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Open an encounter for a patient',
    operationId: 'encountersCreate',
    permissions: [PERMISSION_GROUPS.encounters.create],
    statusCode: 201,
    responseType: EncounterResponseDto,
    errors: [
      { status: 404, description: 'Patient, branch or department not found' },
      { status: 409, description: 'No provider is available for this department' },
    ],
  })
  create(@Body() body: CreateEncounterDto) {
    return this.encounters.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List encounters (filters + pagination)',
    operationId: 'encountersList',
    permissions: [PERMISSION_GROUPS.encounters.read],
    responseType: ListEncountersQueryDto,
  })
  list(@Query() query: ListEncountersQueryDto) {
    return this.encounters.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get an encounter',
    operationId: 'encountersGet',
    permissions: [PERMISSION_GROUPS.encounters.read],
    responseType: EncounterResponseDto,
  })
  get(@Param('id') id: string) {
    return this.encounters.get(id);
  }

  @Patch(':id/status')
  @ApiEndpoint({
    summary: 'Transition an encounter (open → in progress → complete)',
    description: 'A COMPLETED encounter is locked; validated via the workflow engine.',
    operationId: 'encountersTransition',
    permissions: [PERMISSION_GROUPS.encounters.update],
    responseType: EncounterResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  transition(@Param('id') id: string, @Body() body: TransitionEncounterDto) {
    return this.encounters.transition(id, body);
  }
}