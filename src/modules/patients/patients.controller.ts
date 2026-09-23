import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { PatientsService, type AccessContext } from './patients.service';
import {
  AddAllergyDto,
  AddGuardianDto,
  AddMedicalHistoryDto,
  AmendAllergyDto,
  ConfirmNotDuplicateDto,
  ConsentType,
  CreatePatientDto,
  GrantConsentDto,
  ListPatientsQueryDto,
  MergePatientsDto,
  PatientAccessLogResponseDto,
  PatientListResponseDto,
  PatientResponseDto,
  PatientTimelineResponseDto,
  UpdateAllergyStatusDto,
  UpdatePatientDto,
  WithdrawConsentDto,
} from './dto/patient.dto';

function accessContext(req: FastifyRequest): AccessContext {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return {
    ip: forwardedValue?.split(',')[0]?.trim() || req.ip || undefined,
    userAgent:
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent']
        : undefined,
  };
}

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Register a patient',
    description:
      'Assigns an org-scoped patient number (PAT-YYYY-NNNNNN) and runs duplicate detection. A likely duplicate returns 409 POSSIBLE_DUPLICATE with candidate ids.',
    operationId: 'patientsRegister',
    permissions: [PERMISSION_GROUPS.patients.create],
    statusCode: 201,
    responseType: PatientResponseDto,
    errors: [
      { status: 409, description: 'Possible duplicate (POSSIBLE_DUPLICATE)' },
    ],
  })
  register(@Body() body: CreatePatientDto) {
    return this.patients.register(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List patients (search + status filter, paginated)',
    operationId: 'patientsList',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientListResponseDto,
  })
  list(@Query() query: ListPatientsQueryDto) {
    return this.patients.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a patient demographics record (access-logged)',
    operationId: 'patientsGet',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientResponseDto,
  })
  get(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.patients.findById(id, accessContext(req));
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a patient record (optimistic concurrency via version)',
    operationId: 'patientsUpdate',
    permissions: [PERMISSION_GROUPS.patients.update],
    responseType: PatientResponseDto,
    errors: [
      { status: 409, description: 'Version conflict — record was modified concurrently' },
    ],
  })
  update(@Param('id') id: string, @Body() body: UpdatePatientDto) {
    return this.patients.update(id, body);
  }

  @Post(':id/confirm-not-duplicate')
  @ApiEndpoint({
    summary: 'Mark an existing record as not being a duplicate',
    operationId: 'patientsConfirmNotDuplicate',
    permissions: [PERMISSION_GROUPS.patients.manage],
    responseType: PatientResponseDto,
  })
  confirmNotDuplicate(@Param('id') id: string, @Body() body: ConfirmNotDuplicateDto) {
    return this.patients.confirmNotDuplicate(id, body.reason);
  }

  @Post(':id/merge')
  @ApiEndpoint({
    summary: 'Merge a source patient into this (surviving) record',
    description:
      'The source is kept as MERGED with a pointer; guardians/consents are re-pointed (duplicates skipped), allergies and medical history are transferred.',
    operationId: 'patientsMerge',
    permissions: [PERMISSION_GROUPS.patients.merge],
    responseType: PatientResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition (non-ACTIVE record)' },
    ],
  })
  merge(@Param('id') id: string, @Body() body: MergePatientsDto) {
    return this.patients.merge(id, body);
  }

  @Get(':id/master')
  @ApiEndpoint({
    summary: 'Full permission-aware master record (demographics + sections)',
    operationId: 'patientsMasterRecord',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientResponseDto,
  })
  master(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.patients.masterRecord(id, accessContext(req));
  }

  @Get(':id/timeline')
  @ApiEndpoint({
    summary: 'Permission-filtered activity timeline',
    description:
      'Returns only timeline entries the caller has the permission to see.',
    operationId: 'patientsTimeline',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientTimelineResponseDto,
  })
  timeline(@Param('id') id: string, @Query() query: ListPatientsQueryDto, @Req() req: FastifyRequest) {
    return this.patients.timeline(
      id,
      { page: query.page, limit: query.limit },
      accessContext(req),
    );
  }

  @Get(':id/access-log')
  @ApiEndpoint({
    summary: 'List access-log entries for a patient',
    operationId: 'patientsAccessLog',
    permissions: [PERMISSION_GROUPS.patients.manage],
    responseType: PatientAccessLogResponseDto,
  })
  accessLog(@Param('id') id: string, @Query() query: ListPatientsQueryDto, @Req() req: FastifyRequest) {
    return this.patients.accessLog(
      id,
      { page: query.page, limit: query.limit },
      accessContext(req),
    );
  }

  // --- guardians -----------------------------------------------------------

  @Get(':id/guardians')
  @ApiEndpoint({
    summary: 'List guardians for a patient (access-logged)',
    operationId: 'patientsListGuardians',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientResponseDto,
    okResponse: { isArray: true },
  })
  listGuardians(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.patients.listGuardians(id, accessContext(req));
  }

  @Post(':id/guardians')
  @ApiEndpoint({
    summary: 'Add a guardian (reuses existing guardian by phone when present)',
    operationId: 'patientsAddGuardian',
    permissions: [PERMISSION_GROUPS.patients.update],
    statusCode: 201,
    responseType: PatientResponseDto,
  })
  addGuardian(@Param('id') id: string, @Body() body: AddGuardianDto) {
    return this.patients.addGuardian(id, body);
  }

  @Post(':id/guardians/:guardianId/remove')
  @ApiEndpoint({
    summary: 'Remove a guardian link from a patient (idempotent)',
    operationId: 'patientsRemoveGuardian',
    permissions: [PERMISSION_GROUPS.patients.update],
    responseType: PatientResponseDto,
  })
  removeGuardian(@Param('id') id: string, @Param('guardianId') guardianId: string) {
    return this.patients.removeGuardian(id, guardianId);
  }

  // --- consents ------------------------------------------------------------

  @Get(':id/consents')
  @ApiEndpoint({
    summary: 'List consents for a patient (access-logged)',
    operationId: 'patientsListConsents',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientResponseDto,
    okResponse: { isArray: true },
  })
  listConsents(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.patients.listConsents(id, accessContext(req));
  }

  @Post(':id/consents/grant')
  @ApiEndpoint({
    summary: 'Grant a consent type to a patient',
    operationId: 'patientsGrantConsent',
    permissions: [PERMISSION_GROUPS.patients.update],
    statusCode: 201,
    responseType: PatientResponseDto,
  })
  grantConsent(@Param('id') id: string, @Body() body: GrantConsentDto) {
    return this.patients.grantConsent(id, body);
  }

  @Post(':id/consents/:type/withdraw')
  @ApiEndpoint({
    summary: 'Withdraw a granted consent type',
    operationId: 'patientsWithdrawConsent',
    permissions: [PERMISSION_GROUPS.patients.update],
    responseType: PatientResponseDto,
  })
  withdrawConsent(
    @Param('id') id: string,
    @Param('type') type: string,
    @Body() body: WithdrawConsentDto,
  ) {
    return this.patients.withdrawConsent(id, ConsentType.parse(type), body);
  }

  // --- allergies -----------------------------------------------------------

  @Get(':id/allergies')
  @ApiEndpoint({
    summary: 'List allergies for a patient (access-logged)',
    operationId: 'patientsListAllergies',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientResponseDto,
    okResponse: { isArray: true },
  })
  listAllergies(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.patients.listAllergies(id, accessContext(req));
  }

  @Post(':id/allergies')
  @ApiEndpoint({
    summary: 'Record an allergy for a patient',
    operationId: 'patientsRecordAllergy',
    permissions: [PERMISSION_GROUPS.patients.update],
    statusCode: 201,
    responseType: PatientResponseDto,
  })
  recordAllergy(@Param('id') id: string, @Body() body: AddAllergyDto) {
    return this.patients.recordAllergy(id, body);
  }

  @Patch(':id/allergies/:allergyId/status')
  @ApiEndpoint({
    summary: 'Resolve or reopen an allergy (amended allergies cannot be reopened)',
    operationId: 'patientsUpdateAllergyStatus',
    permissions: [PERMISSION_GROUPS.patients.update],
    responseType: PatientResponseDto,
  })
  updateAllergyStatus(
    @Param('id') id: string,
    @Param('allergyId') allergyId: string,
    @Body() body: UpdateAllergyStatusDto,
  ) {
    return this.patients.updateAllergyStatus(id, allergyId, body);
  }

  @Post(':id/allergies/:allergyId/amend')
  @ApiEndpoint({
    summary: 'Amend an allergy: supersedes it (AMENDED) with a corrected entry',
    operationId: 'patientsAmendAllergy',
    permissions: [PERMISSION_GROUPS.patients.update],
    statusCode: 201,
    responseType: PatientResponseDto,
  })
  amendAllergy(
    @Param('id') id: string,
    @Param('allergyId') allergyId: string,
    @Body() body: AmendAllergyDto,
  ) {
    return this.patients.amendAllergy(id, allergyId, body);
  }

  // --- medical history -----------------------------------------------------

  @Get(':id/medical-history')
  @ApiEndpoint({
    summary: 'List medical history entries (access-logged)',
    operationId: 'patientsListMedicalHistory',
    permissions: [PERMISSION_GROUPS.patients.read],
    responseType: PatientResponseDto,
    okResponse: { isArray: true },
  })
  listMedicalHistory(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.patients.listMedicalHistory(id, accessContext(req));
  }

  @Post(':id/medical-history')
  @ApiEndpoint({
    summary: 'Add a medical history entry (append-only)',
    operationId: 'patientsAddMedicalHistory',
    permissions: [PERMISSION_GROUPS.patients.update],
    statusCode: 201,
    responseType: PatientResponseDto,
  })
  addMedicalHistory(@Param('id') id: string, @Body() body: AddMedicalHistoryDto) {
    return this.patients.addMedicalHistory(id, body);
  }
}