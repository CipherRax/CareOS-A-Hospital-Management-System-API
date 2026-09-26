import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ErrorCodes } from '../../common/errors/codes';
import { MaintenanceService } from './maintenance.service';
import {
  CompleteMaintenanceDto,
  ListMaintenanceQueryDto,
  ListRemindersQueryDto,
  MaintenanceResponseDto,
  ReminderResponseDto,
  ScheduleMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Schedule maintenance for an ACTIVE asset',
    operationId: 'maintenanceSchedule',
    permissions: [PERMISSION_GROUPS.maintenance.create],
    statusCode: 201,
    responseType: MaintenanceResponseDto,
    errors: [
      { status: 404, description: 'Asset not found' },
      {
        status: 409,
        code: ErrorCodes.MAINTENANCE_STATE_CONFLICT,
        description: 'Only ACTIVE assets can be scheduled',
      },
    ],
  })
  schedule(@Body() body: ScheduleMaintenanceDto) {
    return this.maintenance.schedule(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List maintenance records (asset/status/upcoming filters)',
    operationId: 'maintenanceList',
    permissions: [PERMISSION_GROUPS.maintenance.read],
    responseType: ListMaintenanceQueryDto,
  })
  list(@Query() query: ListMaintenanceQueryDto) {
    return this.maintenance.list(query);
  }

  @Post('reminders/queue')
  @ApiEndpoint({
    summary: 'Queue maintenance reminders for due/soon-due records (idempotent)',
    operationId: 'maintenanceRemindersQueue',
    permissions: [PERMISSION_GROUPS.maintenance.manage],
    statusCode: 201,
  })
  queueReminders() {
    return this.maintenance.queueReminders();
  }

  @Get('reminders')
  @ApiEndpoint({
    summary: 'List queued/sent maintenance reminders',
    operationId: 'maintenanceRemindersList',
    permissions: [PERMISSION_GROUPS.maintenance.read],
    responseType: ListRemindersQueryDto,
  })
  listReminders(@Query() query: ListRemindersQueryDto) {
    return this.maintenance.listReminders(query);
  }

  @Post('reminders/:id/sent')
  @ApiEndpoint({
    summary: 'Mark a queued reminder as delivered (STRUCTURAL STUB, see limitations)',
    operationId: 'maintenanceRemindersSent',
    permissions: [PERMISSION_GROUPS.maintenance.manage],
    statusCode: 201,
    responseType: ReminderResponseDto,
    errors: [{ status: 404, description: 'Reminder not found' }],
  })
  markReminderSent(@Param('id') id: string) {
    return this.maintenance.markReminderSent(id);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one maintenance record',
    operationId: 'maintenanceGet',
    permissions: [PERMISSION_GROUPS.maintenance.read],
    responseType: MaintenanceResponseDto,
    errors: [{ status: 404, description: 'Maintenance record not found' }],
  })
  get(@Param('id') id: string) {
    return this.maintenance.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Reschedule a PLANNED maintenance job',
    operationId: 'maintenanceReschedule',
    permissions: [PERMISSION_GROUPS.maintenance.create],
    responseType: MaintenanceResponseDto,
    errors: [
      { status: 404, description: 'Maintenance record not found' },
      {
        status: 409,
        code: ErrorCodes.MAINTENANCE_STATE_CONFLICT,
        description: 'Only PLANNED jobs can be rescheduled',
      },
    ],
  })
  update(@Param('id') id: string, @Body() body: UpdateMaintenanceDto) {
    return this.maintenance.update(id, body);
  }

  @Post(':id/start')
  @ApiEndpoint({
    summary: 'Start maintenance work (asset goes MAINTENANCE)',
    operationId: 'maintenanceStart',
    permissions: [PERMISSION_GROUPS.maintenance.manage],
    statusCode: 201,
    responseType: MaintenanceResponseDto,
    errors: [
      { status: 404, description: 'Maintenance record not found' },
      {
        status: 409,
        code: ErrorCodes.MAINTENANCE_STATE_CONFLICT,
        description: 'Only PLANNED jobs can be started',
      },
    ],
  })
  start(@Param('id') id: string) {
    return this.maintenance.start(id);
  }

  @Post(':id/complete')
  @ApiEndpoint({
    summary: 'Complete maintenance (records downtime/cost, asset back to ACTIVE)',
    operationId: 'maintenanceComplete',
    permissions: [PERMISSION_GROUPS.maintenance.manage],
    statusCode: 201,
    responseType: MaintenanceResponseDto,
    errors: [
      { status: 404, description: 'Maintenance record not found' },
      {
        status: 409,
        code: ErrorCodes.MAINTENANCE_STATE_CONFLICT,
        description: 'Only PLANNED/IN_PROGRESS jobs can be completed',
      },
    ],
  })
  complete(@Param('id') id: string, @Body() body: CompleteMaintenanceDto) {
    return this.maintenance.complete(id, body);
  }

  @Post(':id/cancel')
  @ApiEndpoint({
    summary: 'Cancel a PLANNED/IN_PROGRESS job (asset back to ACTIVE)',
    operationId: 'maintenanceCancel',
    permissions: [PERMISSION_GROUPS.maintenance.manage],
    statusCode: 201,
    responseType: MaintenanceResponseDto,
    errors: [
      { status: 404, description: 'Maintenance record not found' },
      {
        status: 409,
        code: ErrorCodes.MAINTENANCE_STATE_CONFLICT,
        description: 'Only PLANNED/IN_PROGRESS jobs can be cancelled',
      },
    ],
  })
  cancel(@Param('id') id: string) {
    return this.maintenance.cancel(id);
  }
}