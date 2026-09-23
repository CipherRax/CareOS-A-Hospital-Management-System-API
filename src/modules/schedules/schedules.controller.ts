import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { SchedulesService } from './schedules.service';
import {
  CreateProviderScheduleDto,
  CreateScheduleOverrideDto,
  ListSchedulesQueryDto,
  ListSlotsQueryDto,
  UpdateProviderScheduleDto,
  UpdateScheduleOverrideDto,
} from './dto/schedule.dto';

@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  // --- weekly templates ----------------------------------------------------

  @Post('templates')
  @ApiEndpoint({
    summary: 'Create a weekly provider schedule template',
    operationId: 'schedulesCreateTemplate',
    permissions: [PERMISSION_GROUPS.schedules.manage],
    statusCode: 201,
    responseType: CreateProviderScheduleDto,
  })
  createTemplate(@Body() body: CreateProviderScheduleDto) {
    return this.schedules.createTemplate(body);
  }

  @Get('templates')
  @ApiEndpoint({
    summary: 'List weekly provider schedule templates',
    operationId: 'schedulesListTemplates',
    permissions: [PERMISSION_GROUPS.schedules.read],
    responseType: ListSchedulesQueryDto,
  })
  listTemplates(@Query() query: ListSchedulesQueryDto) {
    return this.schedules.listTemplates(query);
  }

  @Patch('templates/:id')
  @ApiEndpoint({
    summary: 'Update a weekly template',
    operationId: 'schedulesUpdateTemplate',
    permissions: [PERMISSION_GROUPS.schedules.manage],
    responseType: UpdateProviderScheduleDto,
  })
  updateTemplate(@Param('id') id: string, @Body() body: UpdateProviderScheduleDto) {
    return this.schedules.updateTemplate(id, body);
  }

  @Delete('templates/:id')
  @ApiEndpoint({
    summary: 'Delete a weekly template',
    operationId: 'schedulesRemoveTemplate',
    permissions: [PERMISSION_GROUPS.schedules.manage],
    statusCode: 204,
  })
  removeTemplate(@Param('id') id: string) {
    return this.schedules.removeTemplate(id);
  }

  // --- date overrides -------------------------------------------------------

  @Post('overrides')
  @ApiEndpoint({
    summary: 'Create a date override (working / leave / holiday / blocked)',
    operationId: 'schedulesCreateOverride',
    permissions: [PERMISSION_GROUPS.schedules.manage],
    statusCode: 201,
    responseType: CreateScheduleOverrideDto,
  })
  createOverride(@Body() body: CreateScheduleOverrideDto) {
    return this.schedules.createOverride(body);
  }

  @Patch('overrides/:id')
  @ApiEndpoint({
    summary: 'Update a date override',
    operationId: 'schedulesUpdateOverride',
    permissions: [PERMISSION_GROUPS.schedules.manage],
    responseType: UpdateScheduleOverrideDto,
  })
  updateOverride(@Param('id') id: string, @Body() body: UpdateScheduleOverrideDto) {
    return this.schedules.updateOverride(id, body);
  }

  @Delete('overrides/:id')
  @ApiEndpoint({
    summary: 'Delete a date override',
    operationId: 'schedulesRemoveOverride',
    permissions: [PERMISSION_GROUPS.schedules.manage],
    statusCode: 204,
  })
  removeOverride(@Param('id') id: string) {
    return this.schedules.removeOverride(id);
  }

  // --- slot discovery -------------------------------------------------------

  @Get('slots')
  @ApiEndpoint({
    summary: 'Compute bookable slots for a provider on a business day',
    description:
      'Weekly templates (minus breaks/overrides) minus already-occupied capacity; PAST slots are hidden unless ?includePast=true.',
    operationId: 'schedulesListSlots',
    permissions: [PERMISSION_GROUPS.schedules.read],
    responseType: ListSlotsQueryDto,
  })
  listSlots(@Query() query: ListSlotsQueryDto) {
    return this.schedules.listSlots(query);
  }
}