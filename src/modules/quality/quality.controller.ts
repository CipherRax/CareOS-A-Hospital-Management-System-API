import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ComplaintsService } from './complaints.service';
import { FeedbackService } from './feedback.service';
import { IncidentsService } from './incidents.service';
import {
  ComplaintResponseDto,
  CreateComplaintDto,
  CreateIncidentDto,
  FeedbackResponseDto,
  IncidentResponseDto,
  ListComplaintsQueryDto,
  ListFeedbackQueryDto,
  ListIncidentsQueryDto,
  RespondFeedbackDto,
  SubmitFeedbackDto,
  UpdateComplaintStatusDto,
  UpdateIncidentStatusDto,
} from './dto/quality.dto';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Submit feedback',
    operationId: 'feedbackSubmit',
    permissions: [PERMISSION_GROUPS.feedback.submit],
    statusCode: 201,
    responseType: FeedbackResponseDto,
  })
  submit(@Body() body: SubmitFeedbackDto) {
    return this.feedback.submit(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List feedback (filters + pagination)',
    operationId: 'feedbackList',
    permissions: [PERMISSION_GROUPS.feedback.read],
    responseType: FeedbackResponseDto,
  })
  list(@Query() query: ListFeedbackQueryDto) {
    return this.feedback.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one feedback record',
    operationId: 'feedbackGet',
    permissions: [PERMISSION_GROUPS.feedback.read],
    responseType: FeedbackResponseDto,
    errors: [{ status: 404, description: 'Feedback not found' }],
  })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.feedback.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Respond to feedback (acknowledge/resolve/close)',
    operationId: 'feedbackRespond',
    permissions: [PERMISSION_GROUPS.feedback.respond],
    responseType: FeedbackResponseDto,
    errors: [{ status: 404, description: 'Feedback not found' }],
  })
  respond(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: RespondFeedbackDto) {
    return this.feedback.respond(id, body);
  }
}

@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a complaint',
    operationId: 'complaintsCreate',
    permissions: [PERMISSION_GROUPS.complaints.manage],
    statusCode: 201,
    responseType: ComplaintResponseDto,
    errors: [{ status: 404, description: 'Assigned user not found in this organization' }],
  })
  create(@Body() body: CreateComplaintDto) {
    return this.complaints.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List complaints (filters + pagination)',
    operationId: 'complaintsList',
    permissions: [PERMISSION_GROUPS.complaints.read],
    responseType: ComplaintResponseDto,
  })
  list(@Query() query: ListComplaintsQueryDto) {
    return this.complaints.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one complaint',
    operationId: 'complaintsGet',
    permissions: [PERMISSION_GROUPS.complaints.read],
    responseType: ComplaintResponseDto,
    errors: [{ status: 404, description: 'Complaint not found' }],
  })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.complaints.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a complaint status (assign/investigate/resolve/close)',
    operationId: 'complaintsUpdateStatus',
    permissions: [PERMISSION_GROUPS.complaints.manage],
    responseType: ComplaintResponseDto,
    errors: [
      { status: 404, description: 'Complaint not found' },
      { status: 409, description: 'Invalid workflow transition (e.g. closing without resolution)' },
    ],
  })
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateComplaintStatusDto,
  ) {
    return this.complaints.updateStatus(id, body);
  }
}

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Report an incident',
    operationId: 'incidentsCreate',
    permissions: [PERMISSION_GROUPS.incidents.manage],
    statusCode: 201,
    responseType: IncidentResponseDto,
  })
  create(@Body() body: CreateIncidentDto) {
    return this.incidents.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List incidents (filters + pagination)',
    operationId: 'incidentsList',
    permissions: [PERMISSION_GROUPS.incidents.read],
    responseType: IncidentResponseDto,
  })
  list(@Query() query: ListIncidentsQueryDto) {
    return this.incidents.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one incident',
    operationId: 'incidentsGet',
    permissions: [PERMISSION_GROUPS.incidents.read],
    responseType: IncidentResponseDto,
    errors: [{ status: 404, description: 'Incident not found' }],
  })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.incidents.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update an incident status (investigate/action plan/resolve/close)',
    operationId: 'incidentsUpdateStatus',
    permissions: [PERMISSION_GROUPS.incidents.manage],
    responseType: IncidentResponseDto,
    errors: [
      { status: 404, description: 'Incident not found' },
      { status: 409, description: 'Invalid workflow transition' },
    ],
  })
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateIncidentStatusDto,
  ) {
    return this.incidents.updateStatus(id, body);
  }
}