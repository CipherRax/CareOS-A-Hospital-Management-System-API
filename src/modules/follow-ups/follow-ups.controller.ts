import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { FollowUpsService } from './follow-ups.service';
import {
  CreateFollowUpDto,
  FollowUpResponseDto,
  ListFollowUpsQueryDto,
  TransitionFollowUpDto,
} from './dto/follow-up.dto';

@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Schedule a follow-up for a patient',
    operationId: 'followUpsCreate',
    permissions: [PERMISSION_GROUPS.followUps.create],
    statusCode: 201,
    responseType: FollowUpResponseDto,
  })
  create(@Body() body: CreateFollowUpDto) {
    return this.followUps.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List follow-ups (filters + pagination)',
    operationId: 'followUpsList',
    permissions: [PERMISSION_GROUPS.followUps.read],
    responseType: ListFollowUpsQueryDto,
  })
  list(@Query() query: ListFollowUpsQueryDto) {
    return this.followUps.list(query);
  }

  @Post(':id/transition')
  @ApiEndpoint({
    summary: 'Complete or cancel a follow-up',
    operationId: 'followUpsTransition',
    permissions: [PERMISSION_GROUPS.followUps.update],
    statusCode: 201,
    responseType: FollowUpResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  transition(@Param('id') id: string, @Body() body: TransitionFollowUpDto) {
    return this.followUps.transition(id, body);
  }
}