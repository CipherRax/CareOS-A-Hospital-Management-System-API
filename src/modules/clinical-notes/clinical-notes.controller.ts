import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ClinicalNotesService } from './clinical-notes.service';
import {
  AmendClinicalNoteDto,
  ClinicalNoteResponseDto,
  ClinicalNoteTemplateResponseDto,
  CreateClinicalNoteDto,
  CreateClinicalNoteTemplateDto,
  FinalizeClinicalNoteDto,
  ListClinicalNotesQueryDto,
  ListClinicalNoteTemplatesQueryDto,
  UpdateClinicalNoteDto,
} from './dto/clinical-note.dto';

@Controller('clinical-notes')
export class ClinicalNotesController {
  constructor(private readonly notes: ClinicalNotesService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a clinical note (DRAFT) linked to an open encounter',
    operationId: 'clinicalNotesCreate',
    permissions: [PERMISSION_GROUPS.clinicalNotes.create],
    statusCode: 201,
    responseType: ClinicalNoteResponseDto,
    errors: [
      { status: 404, description: 'Encounter or template not found' },
      { status: 409, description: 'Encounter is COMPLETED and locked' },
    ],
  })
  create(@Body() body: CreateClinicalNoteDto) {
    return this.notes.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List clinical notes (by patient, encounter or status)',
    operationId: 'clinicalNotesList',
    permissions: [PERMISSION_GROUPS.clinicalNotes.read],
    responseType: ListClinicalNotesQueryDto,
  })
  list(@Query() query: ListClinicalNotesQueryDto) {
    return this.notes.list(query);
  }

  @Post('templates')
  @ApiEndpoint({
    summary: 'Create a clinical note template',
    operationId: 'clinicalNoteTemplatesCreate',
    permissions: [PERMISSION_GROUPS.clinicalNotes.manage],
    statusCode: 201,
    responseType: ClinicalNoteTemplateResponseDto,
  })
  createTemplate(@Body() body: CreateClinicalNoteTemplateDto) {
    return this.notes.createTemplate(body);
  }

  @Get('templates')
  @ApiEndpoint({
    summary: 'List active clinical note templates',
    operationId: 'clinicalNoteTemplatesList',
    permissions: [PERMISSION_GROUPS.clinicalNotes.read],
    responseType: ListClinicalNoteTemplatesQueryDto,
  })
  listTemplates(@Query() query: ListClinicalNoteTemplatesQueryDto) {
    return this.notes.listTemplates(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a clinical note with its full version history',
    operationId: 'clinicalNotesGet',
    permissions: [PERMISSION_GROUPS.clinicalNotes.read],
    responseType: ClinicalNoteResponseDto,
  })
  get(@Param('id') id: string) {
    return this.notes.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Edit a DRAFT clinical note in place',
    description: 'FINAL notes are locked; changes go through the amendment endpoint.',
    operationId: 'clinicalNotesUpdate',
    permissions: [PERMISSION_GROUPS.clinicalNotes.update],
    responseType: ClinicalNoteResponseDto,
  })
  update(@Param('id') id: string, @Body() body: UpdateClinicalNoteDto) {
    return this.notes.update(id, body);
  }

  @Post(':id/finalize')
  @ApiEndpoint({
    summary: 'Finalize a DRAFT note (writes the ORIGINAL version)',
    operationId: 'clinicalNotesFinalize',
    permissions: [PERMISSION_GROUPS.clinicalNotes.update],
    statusCode: 201,
    responseType: ClinicalNoteResponseDto,
  })
  finalize(@Param('id') id: string, @Body() body: FinalizeClinicalNoteDto) {
    return this.notes.finalize(id, body);
  }

  @Post(':id/amend')
  @ApiEndpoint({
    summary: 'Amend a FINAL note (appends a new superseding version)',
    description: 'Requires a reason. Produces the ClinicalNoteAmended event; never edits in place.',
    operationId: 'clinicalNotesAmend',
    permissions: [PERMISSION_GROUPS.clinicalNotes.update],
    statusCode: 201,
    responseType: ClinicalNoteResponseDto,
  })
  amend(@Param('id') id: string, @Body() body: AmendClinicalNoteDto) {
    return this.notes.amend(id, body);
  }
}