import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { PortalService } from './portal.service';
import {
  PortalAppointmentResponseDto,
  PortalAppointmentsQueryDto,
  PortalLabResultsQueryDto,
  PortalLabResultResponseDto,
  PortalPatientResponseDto,
  SubmitPortalFeedbackDto,
} from './dto/portal.dto';
import { FeedbackResponseDto } from '../quality/dto/quality.dto';

@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('me')
  @ApiEndpoint({
    summary: 'Get my patient profile',
    operationId: 'portalMe',
    permissions: [PERMISSION_GROUPS.portal.read],
    responseType: PortalPatientResponseDto,
    errors: [{ status: 403, description: 'Patient self-scope required' }],
  })
  me() {
    return this.portal.me();
  }

  @Get('me/appointments')
  @ApiEndpoint({
    summary: 'List my appointments (newest first)',
    operationId: 'portalAppointments',
    permissions: [PERMISSION_GROUPS.portal.read],
    responseType: PortalAppointmentResponseDto,
  })
  appointments(@Query() query: PortalAppointmentsQueryDto) {
    return this.portal.appointments(query);
  }

  @Get('me/lab-results')
  @ApiEndpoint({
    summary: 'List my released lab results',
    operationId: 'portalLabResults',
    permissions: [PERMISSION_GROUPS.portal.read],
    responseType: PortalLabResultResponseDto,
  })
  labResults(@Query() query: PortalLabResultsQueryDto) {
    return this.portal.labResults(query);
  }

  @Post('me/feedback')
  @ApiEndpoint({
    summary: 'Submit feedback as the logged-in patient',
    operationId: 'portalSubmitFeedback',
    permissions: [PERMISSION_GROUPS.portal.read],
    statusCode: 201,
    responseType: FeedbackResponseDto,
    errors: [{ status: 403, description: 'Patient self-scope required' }],
  })
  submitFeedback(@Body() body: SubmitPortalFeedbackDto) {
    return this.portal.submitFeedback(body);
  }
}