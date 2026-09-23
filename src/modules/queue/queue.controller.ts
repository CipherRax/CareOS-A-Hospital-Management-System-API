import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { QueueService } from './queue.service';
import {
  CreateQueueEntryDto,
  ListQueueQueryDto,
  RegisterWalkInDto,
  UpdateQueueEntryStatusDto,
  UpdateQueuePriorityDto,
  UpdateVisitStatusDto,
} from './dto/queue.dto';

@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  // --- registration ---------------------------------------------------------

  @Post('walk-ins/register')
  @ApiEndpoint({
    summary: 'Register a walk-in patient (creates a visit + queue ticket)',
    operationId: 'queueRegisterWalkIn',
    permissions: [PERMISSION_GROUPS.queue.create],
    statusCode: 201,
    responseType: RegisterWalkInDto,
    errors: [
      { status: 409, description: 'Patient already has an active visit (VISIT_ALREADY_ACTIVE)' },
    ],
  })
  registerWalkIn(@Body() body: RegisterWalkInDto) {
    return this.queue.registerWalkIn(body);
  }

  @Post('entries')
  @ApiEndpoint({
    summary: 'Create a queue entry for an active visit',
    operationId: 'queueCreateEntry',
    permissions: [PERMISSION_GROUPS.queue.create],
    statusCode: 201,
    responseType: CreateQueueEntryDto,
    errors: [
      { status: 409, description: 'Already queued in this department or no active visit' },
    ],
  })
  createEntry(@Body() body: CreateQueueEntryDto) {
    return this.queue.createQueueEntry(body);
  }

  @Patch('entries/:id/status')
  @ApiEndpoint({
    summary: 'Transition a queue entry (call / start / complete / no-show / transfer…)',
    operationId: 'queueUpdateEntryStatus',
    permissions: [PERMISSION_GROUPS.queue.manage],
    responseType: UpdateQueueEntryStatusDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition (INVALID_WORKFLOW_TRANSITION)' },
    ],
  })
  updateEntryStatus(@Param('id') id: string, @Body() body: UpdateQueueEntryStatusDto) {
    return this.queue.updateQueueEntryStatus(id, body);
  }

  @Patch('entries/:id/priority')
  @ApiEndpoint({
    summary: 'Reprioritise an active queue entry',
    operationId: 'queueUpdatePriority',
    permissions: [PERMISSION_GROUPS.queue.prioritize],
    responseType: UpdateQueuePriorityDto,
  })
  updatePriority(@Param('id') id: string, @Body() body: UpdateQueuePriorityDto) {
    return this.queue.updatePriority(id, body);
  }

  @Patch('visits/:visitId/status')
  @ApiEndpoint({
    summary: 'Advance the visit journey (triage → provider → lab → billing…)',
    operationId: 'queueUpdateVisitStatus',
    permissions: [PERMISSION_GROUPS.visits.update],
    responseType: UpdateVisitStatusDto,
    errors: [
      { status: 409, description: 'Invalid visit transition (INVALID_WORKFLOW_TRANSITION)' },
    ],
  })
  updateVisitStatus(@Param('visitId') visitId: string, @Body() body: UpdateVisitStatusDto) {
    return this.queue.updateVisitStatus(visitId, body);
  }

  // --- views ----------------------------------------------------------------

  @Get()
  @ApiEndpoint({
    summary: 'List queue entries (department/branch/day filtered)',
    operationId: 'queueList',
    permissions: [PERMISSION_GROUPS.queue.read],
    responseType: ListQueueQueryDto,
  })
  list(@Query() query: ListQueueQueryDto) {
    return this.queue.list(query);
  }

  @Get('status')
  @ApiEndpoint({
    summary: 'Self-service digital-queue status for the scoped patient',
    operationId: 'queueStatus',
    permissions: [PERMISSION_GROUPS.queue.read],
    responseType: ListQueueQueryDto,
  })
  status() {
    return this.queue.status();
  }

  @Get('metrics')
  @ApiEndpoint({
    summary: 'Waiting-room metrics (avg call wait, service time, abandonment)',
    operationId: 'queueMetrics',
    permissions: [PERMISSION_GROUPS.queue.read],
    responseType: ListQueueQueryDto,
  })
  metrics(@Query() query: ListQueueQueryDto) {
    return this.queue.metrics(query);
  }
}