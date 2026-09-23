import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { VitalsService } from './vitals.service';
import {
  CorrectVitalDto,
  ListVitalsQueryDto,
  RecordVitalDto,
} from './dto/vitals.dto';

@Controller('vitals')
export class VitalsController {
  constructor(private readonly vitals: VitalsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Record a vitals observation (append-only)',
    operationId: 'vitalsRecord',
    permissions: [PERMISSION_GROUPS.vitals.record],
    statusCode: 201,
    responseType: RecordVitalDto,
  })
  record(@Body() body: RecordVitalDto) {
    return this.vitals.record(body);
  }

  @Post(':id/correct')
  @ApiEndpoint({
    summary: 'Correct a vitals observation (creates a superseding record)',
    operationId: 'vitalsCorrect',
    permissions: [PERMISSION_GROUPS.vitals.record],
    statusCode: 201,
    responseType: CorrectVitalDto,
  })
  correct(@Param('id') id: string, @Body() body: CorrectVitalDto) {
    return this.vitals.correct(id, body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List vitals observations (patient or visit filtered)',
    operationId: 'vitalsList',
    permissions: [PERMISSION_GROUPS.vitals.read],
    responseType: ListVitalsQueryDto,
  })
  list(@Query() query: ListVitalsQueryDto) {
    return this.vitals.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a vitals observation',
    operationId: 'vitalsGet',
    permissions: [PERMISSION_GROUPS.vitals.read],
    responseType: RecordVitalDto,
  })
  get(@Param('id') id: string) {
    return this.vitals.get(id);
  }
}