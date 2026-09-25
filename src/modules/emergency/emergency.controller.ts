import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EmergencyService } from './emergency.service';
import {
  AdmitFromEmergencyDto,
  AssessEmergencyVisitDto,
  EmergencySummaryResponseDto,
  EmergencyVisitResponseDto,
  ListEmergencyVisitsQueryDto,
  ReferEmergencyVisitDto,
  RegisterEmergencyVisitDto,
  SetEmergencyPriorityDto,
  TreatEmergencyVisitDto,
  TriageEmergencyVisitDto,
} from './dto/emergency.dto';

@Controller()
export class EmergencyController {
  constructor(private readonly emergency: EmergencyService) {}

  @Post('emergency/visits')
  @ApiEndpoint({
    summary: 'Register an emergency department arrival',
    operationId: 'emergencyVisitsRegister',
    permissions: [PERMISSION_GROUPS.emergency.register],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [{ status: 404, description: 'Branch or patient not found' }],
  })
  register(@Body() body: RegisterEmergencyVisitDto) {
    return this.emergency.registerVisit(body);
  }

  @Post('emergency/visits/:id/triage')
  @ApiEndpoint({
    summary: 'Triage an arrival (priority + chief complaint; stamps triagedAt)',
    operationId: 'emergencyVisitsTriage',
    permissions: [PERMISSION_GROUPS.emergency.triage],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit not found' },
      { status: 409, description: 'Invalid transition or visit already closed' },
    ],
  })
  triage(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: TriageEmergencyVisitDto) {
    return this.emergency.triageVisit(id, body);
  }

  @Patch('emergency/visits/:id/priority')
  @ApiEndpoint({
    summary: 'Re-record triage priority (clinician only)',
    operationId: 'emergencyVisitsSetPriority',
    permissions: [PERMISSION_GROUPS.emergency.triage],
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit not found' },
      { status: 409, description: 'Visit already closed' },
    ],
  })
  setPriority(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: SetEmergencyPriorityDto) {
    return this.emergency.setPriority(id, body);
  }

  @Post('emergency/visits/:id/assess')
  @ApiEndpoint({
    summary: 'Record the clinical assessment',
    operationId: 'emergencyVisitsAssess',
    permissions: [PERMISSION_GROUPS.emergency.manage],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit not found' },
      { status: 409, description: 'Invalid transition or visit already closed' },
    ],
  })
  assess(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AssessEmergencyVisitDto) {
    return this.emergency.assessVisit(id, body);
  }

  @Post('emergency/visits/:id/treat')
  @ApiEndpoint({
    summary: 'Start treatment in the emergency department',
    operationId: 'emergencyVisitsTreat',
    permissions: [PERMISSION_GROUPS.emergency.manage],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit not found' },
      { status: 409, description: 'Invalid transition or visit already closed' },
    ],
  })
  treat(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: TreatEmergencyVisitDto) {
    return this.emergency.treatVisit(id, body);
  }

  @Post('emergency/visits/:id/observe')
  @ApiEndpoint({
    summary: 'Move a visit into observation',
    operationId: 'emergencyVisitsObserve',
    permissions: [PERMISSION_GROUPS.emergency.manage],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit not found' },
      { status: 409, description: 'Invalid transition or visit already closed' },
    ],
  })
  observe(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.emergency.observeVisit(id);
  }

  @Post('emergency/visits/:id/admit')
  @ApiEndpoint({
    summary: 'Admit to inpatient from the emergency department',
    operationId: 'emergencyVisitsAdmit',
    permissions: [PERMISSION_GROUPS.emergency.manage],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit, bed or patient not found' },
      { status: 409, description: 'Bed unavailable, patient already admitted, or visit closed' },
    ],
  })
  admit(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AdmitFromEmergencyDto) {
    return this.emergency.admitVisit(id, body);
  }

  @Post('emergency/visits/:id/refer')
  @ApiEndpoint({
    summary: 'Refer the patient onward (final disposition)',
    operationId: 'emergencyVisitsRefer',
    permissions: [PERMISSION_GROUPS.emergency.manage],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit not found' },
      { status: 409, description: 'Invalid transition or visit already closed' },
    ],
  })
  refer(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReferEmergencyVisitDto) {
    return this.emergency.referVisit(id, body);
  }

  @Post('emergency/visits/:id/discharge')
  @ApiEndpoint({
    summary: 'Discharge from the emergency department (final disposition)',
    operationId: 'emergencyVisitsDischarge',
    permissions: [PERMISSION_GROUPS.emergency.manage],
    statusCode: 201,
    responseType: EmergencyVisitResponseDto,
    errors: [
      { status: 404, description: 'Emergency visit not found' },
      { status: 409, description: 'Invalid transition or visit already closed' },
    ],
  })
  discharge(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.emergency.dischargeVisit(id);
  }

  @Get('emergency/visits')
  @ApiEndpoint({
    summary: 'List emergency visits (filters + pagination)',
    operationId: 'emergencyVisitsList',
    permissions: [PERMISSION_GROUPS.emergency.read],
    responseType: ListEmergencyVisitsQueryDto,
  })
  list(@Query() query: ListEmergencyVisitsQueryDto) {
    return this.emergency.listVisits(query);
  }

  @Get('emergency/visits/:id')
  @ApiEndpoint({
    summary: 'Get an emergency visit',
    operationId: 'emergencyVisitsGet',
    permissions: [PERMISSION_GROUPS.emergency.read],
    responseType: EmergencyVisitResponseDto,
    errors: [{ status: 404, description: 'Emergency visit not found' }],
  })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.emergency.getVisit(id);
  }

  @Get('emergency/summary')
  @ApiEndpoint({
    summary: 'Emergency department analytics for today',
    operationId: 'emergencySummary',
    permissions: [PERMISSION_GROUPS.emergency.read],
    responseType: EmergencySummaryResponseDto,
  })
  summary() {
    return this.emergency.summary();
  }
}