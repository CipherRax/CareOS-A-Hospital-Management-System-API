import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { AppointmentsService } from './appointments.service';
import {
  AcceptWaitlistOfferDto,
  BookAppointmentDto,
  CancelAppointmentDto,
  JoinWaitlistDto,
  ListAppointmentsQueryDto,
  ListWaitlistQueryDto,
  RescheduleAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointment.dto';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Book an appointment for a bookable slot',
    description:
      'Capacity-aware: serialized per (org, provider, slot) so concurrent double-bookings yield exactly one success.',
    operationId: 'appointmentsBook',
    permissions: [PERMISSION_GROUPS.appointments.create],
    statusCode: 201,
    responseType: BookAppointmentDto,
    errors: [
      { status: 409, description: 'Slot conflict or full (APPOINTMENT_CONFLICT)' },
    ],
  })
  book(@Body() body: BookAppointmentDto) {
    return this.appointments.book(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List appointments (filters + pagination)',
    operationId: 'appointmentsList',
    permissions: [PERMISSION_GROUPS.appointments.read],
    responseType: ListAppointmentsQueryDto,
  })
  list(@Query() query: ListAppointmentsQueryDto) {
    return this.appointments.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get an appointment',
    operationId: 'appointmentsGet',
    permissions: [PERMISSION_GROUPS.appointments.read],
    responseType: BookAppointmentDto,
  })
  get(@Param('id') id: string) {
    return this.appointments.get(id);
  }

  @Patch(':id/status')
  @ApiEndpoint({
    summary: 'Transition an appointment (confirm / check-in / start / complete / cancel / no-show)',
    operationId: 'appointmentsTransition',
    permissions: [PERMISSION_GROUPS.appointments.manage],
    responseType: UpdateAppointmentStatusDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition' },
    ],
  })
  transition(@Param('id') id: string, @Body() body: UpdateAppointmentStatusDto) {
    return this.appointments.transition(id, body);
  }

  @Post(':id/reschedule')
  @ApiEndpoint({
    summary: 'Reschedule an appointment to a bookable slot',
    description:
      'The current slot must be released first (booking → RESCHEDULED) then a fresh booking is created and linked.',
    operationId: 'appointmentsReschedule',
    permissions: [PERMISSION_GROUPS.appointments.reschedule],
    statusCode: 201,
    responseType: RescheduleAppointmentDto,
    errors: [
      { status: 409, description: 'Slot conflict or invalid state (APPOINTMENT_CONFLICT)' },
    ],
  })
  reschedule(@Param('id') id: string, @Body() body: RescheduleAppointmentDto) {
    return this.appointments.reschedule(id, body);
  }

  @Post(':id/cancel')
  @ApiEndpoint({
    summary: 'Cancel an appointment (frees the slot to the waitlist)',
    operationId: 'appointmentsCancel',
    permissions: [PERMISSION_GROUPS.appointments.cancel],
    statusCode: 201,
    responseType: CancelAppointmentDto,
  })
  cancel(@Param('id') id: string, @Body() body: CancelAppointmentDto) {
    return this.appointments.cancel(id, body);
  }

  // --- waitlist ------------------------------------------------------------

  @Post('waitlist/entries')
  @ApiEndpoint({
    summary: 'Join the department waitlist',
    operationId: 'appointmentsJoinWaitlist',
    permissions: [PERMISSION_GROUPS.waitlist.manage],
    statusCode: 201,
    responseType: JoinWaitlistDto,
    errors: [
      { status: 409, description: 'Duplicate entry or waitlist full' },
    ],
  })
  joinWaitlist(@Body() body: JoinWaitlistDto) {
    return this.appointments.joinWaitlist(body);
  }

  @Get('waitlist/entries')
  @ApiEndpoint({
    summary: 'List waitlist entries',
    operationId: 'appointmentsListWaitlist',
    permissions: [PERMISSION_GROUPS.waitlist.read],
    responseType: ListWaitlistQueryDto,
  })
  listWaitlist(@Query() query: ListWaitlistQueryDto) {
    return this.appointments.listWaitlist(query);
  }

  @Post('waitlist/entries/:id/accept')
  @ApiEndpoint({
    summary: 'Accept a waitlist offer (books the offered slot)',
    operationId: 'appointmentsAcceptWaitlistOffer',
    permissions: [PERMISSION_GROUPS.waitlist.manage],
    statusCode: 201,
    responseType: AcceptWaitlistOfferDto,
    errors: [
      { status: 409, description: 'Offer expired or already actioned' },
    ],
  })
  acceptWaitlistOffer(@Param('id') id: string, @Body() body: AcceptWaitlistOfferDto) {
    return this.appointments.acceptWaitlistOffer(id, body);
  }

  @Post('waitlist/entries/:id/decline')
  @ApiEndpoint({
    summary: 'Decline a waitlist offer (re-offers the slot to the next entrant)',
    operationId: 'appointmentsDeclineWaitlistOffer',
    permissions: [PERMISSION_GROUPS.waitlist.manage],
    statusCode: 201,
    responseType: CancelAppointmentDto,
  })
  declineWaitlistOffer(@Param('id') id: string, @Body() body: CancelAppointmentDto) {
    return this.appointments.declineWaitlistOffer(id, body.reason);
  }

  @Post('waitlist/entries/:id/leave')
  @ApiEndpoint({
    summary: 'Remove a WAITING/OFFERED entry from the waitlist',
    operationId: 'appointmentsLeaveWaitlist',
    permissions: [PERMISSION_GROUPS.waitlist.manage],
    statusCode: 201,
    responseType: JoinWaitlistDto,
  })
  leaveWaitlist(@Param('id') id: string) {
    return this.appointments.leaveWaitlist(id);
  }
}