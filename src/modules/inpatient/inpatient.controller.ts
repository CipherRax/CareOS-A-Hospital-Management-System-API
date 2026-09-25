import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { InpatientService } from './inpatient.service';
import {
  AdmissionResponseDto,
  BedResponseDto,
  CreateAdmissionDto,
  CreateBedDto,
  CreateRoomDto,
  CreateWardDto,
  DischargeAdmissionDto,
  ListAdmissionsQueryDto,
  ListBedsQueryDto,
  ListWardsQueryDto,
  SetBedStatusDto,
  TransferAdmissionDto,
  UpdateWardDto,
  WardResponseDto,
} from './dto/inpatient.dto';

@Controller()
export class InpatientController {
  constructor(private readonly inpatient: InpatientService) {}

  // ─── wards / rooms / beds ────────────────────────────────────────────────

  @Post('wards')
  @ApiEndpoint({
    summary: 'Create a ward',
    operationId: 'wardsCreate',
    permissions: [PERMISSION_GROUPS.wards.manage],
    statusCode: 201,
    responseType: WardResponseDto,
    errors: [{ status: 404, description: 'Branch not found' }],
  })
  createWard(@Body() body: CreateWardDto) {
    return this.inpatient.createWard(body);
  }

  @Patch('wards/:id')
  @ApiEndpoint({
    summary: 'Update a ward (optimistic lock)',
    operationId: 'wardsUpdate',
    permissions: [PERMISSION_GROUPS.wards.manage],
    responseType: WardResponseDto,
    errors: [{ status: 409, description: 'Ward changed underneath the update' }],
  })
  updateWard(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: UpdateWardDto) {
    return this.inpatient.updateWard(id, body);
  }

  @Get('wards')
  @ApiEndpoint({
    summary: 'List wards (rooms + beds nested)',
    operationId: 'wardsList',
    permissions: [PERMISSION_GROUPS.wards.read],
    responseType: ListWardsQueryDto,
  })
  listWards(@Query() query: ListWardsQueryDto) {
    return this.inpatient.listWards(query);
  }

  @Get('wards/:id')
  @ApiEndpoint({
    summary: 'Get a ward with its rooms and beds',
    operationId: 'wardsGet',
    permissions: [PERMISSION_GROUPS.wards.read],
    responseType: WardResponseDto,
    errors: [{ status: 404, description: 'Ward not found' }],
  })
  getWard(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.inpatient.getWard(id);
  }

  @Post('wards/:id/rooms')
  @ApiEndpoint({
    summary: 'Create a room inside a ward',
    operationId: 'wardsRoomsCreate',
    permissions: [PERMISSION_GROUPS.wards.manage],
    statusCode: 201,
    responseType: WardResponseDto,
    errors: [{ status: 404, description: 'Ward not found' }],
  })
  createRoom(@Param('id', new ParseUUIDPipe()) wardId: string, @Body() body: CreateRoomDto) {
    return this.inpatient.createRoom(wardId, body);
  }

  @Post('rooms/:id/beds')
  @ApiEndpoint({
    summary: 'Create a bed inside a room',
    operationId: 'roomsBedsCreate',
    permissions: [PERMISSION_GROUPS.beds.manage],
    statusCode: 201,
    responseType: BedResponseDto,
    errors: [{ status: 404, description: 'Room not found' }],
  })
  createBed(@Param('id', new ParseUUIDPipe()) roomId: string, @Body() body: CreateBedDto) {
    return this.inpatient.createBed(roomId, body);
  }

  @Patch('beds/:id/status')
  @ApiEndpoint({
    summary: 'Set a bed status (AVAILABLE/RESERVED/CLEANING/MAINTENANCE/BLOCKED)',
    operationId: 'bedsSetStatus',
    permissions: [PERMISSION_GROUPS.beds.manage],
    responseType: BedResponseDto,
    errors: [
      { status: 404, description: 'Bed not found' },
      { status: 409, description: 'Bed changed underneath the update' },
    ],
  })
  setBedStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: SetBedStatusDto) {
    return this.inpatient.setBedStatus(id, body);
  }

  @Get('beds')
  @ApiEndpoint({
    summary: 'List beds (filters + pagination)',
    operationId: 'bedsList',
    permissions: [PERMISSION_GROUPS.beds.read],
    responseType: ListBedsQueryDto,
  })
  listBeds(@Query() query: ListBedsQueryDto) {
    return this.inpatient.listBeds(query);
  }

  // ─── admissions ──────────────────────────────────────────────────────────

  @Post('admissions')
  @ApiEndpoint({
    summary: 'Admit a patient (doctor authorizes → bed row-locked → assigned)',
    operationId: 'admissionsCreate',
    permissions: [PERMISSION_GROUPS.inpatient.create],
    statusCode: 201,
    responseType: AdmissionResponseDto,
    errors: [
      { status: 404, description: 'Patient, branch or bed not found' },
      { status: 409, description: 'Bed unavailable or patient already admitted' },
    ],
  })
  createAdmission(@Body() body: CreateAdmissionDto) {
    return this.inpatient.createAdmission(body);
  }

  @Post('admissions/:id/transfer')
  @ApiEndpoint({
    summary: 'Transfer an admission to another bed (history preserved)',
    operationId: 'admissionsTransfer',
    permissions: [PERMISSION_GROUPS.inpatient.transfer],
    statusCode: 201,
    responseType: AdmissionResponseDto,
    errors: [
      { status: 404, description: 'Admission not found' },
      { status: 409, description: 'Target bed unavailable or invalid transition' },
    ],
  })
  transferAdmission(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TransferAdmissionDto,
  ) {
    return this.inpatient.transferAdmission(id, body);
  }

  @Post('admissions/:id/discharge')
  @ApiEndpoint({
    summary: 'Discharge an admission (summary, instructions, medications, follow-up)',
    operationId: 'admissionsDischarge',
    permissions: [PERMISSION_GROUPS.inpatient.discharge],
    statusCode: 201,
    responseType: AdmissionResponseDto,
    errors: [{ status: 409, description: 'Already discharged or invalid transition' }],
  })
  dischargeAdmission(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DischargeAdmissionDto,
  ) {
    return this.inpatient.dischargeAdmission(id, body);
  }

  @Get('admissions')
  @ApiEndpoint({
    summary: 'List admissions (filters + pagination)',
    operationId: 'admissionsList',
    permissions: [PERMISSION_GROUPS.inpatient.read],
    responseType: ListAdmissionsQueryDto,
  })
  listAdmissions(@Query() query: ListAdmissionsQueryDto) {
    return this.inpatient.listAdmissions(query);
  }

  @Get('admissions/:id')
  @ApiEndpoint({
    summary: 'Get an admission with its assignment history and discharge',
    operationId: 'admissionsGet',
    permissions: [PERMISSION_GROUPS.inpatient.read],
    responseType: AdmissionResponseDto,
    errors: [{ status: 404, description: 'Admission not found' }],
  })
  getAdmission(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.inpatient.getAdmission(id);
  }
}