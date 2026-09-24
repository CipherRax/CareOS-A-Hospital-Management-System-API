import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { CodingService } from './coding.service';
import {
  CodeConceptResponseDto,
  CodingImportResultDto,
  CodingSystemResponseDto,
  CreateCodingSystemDto,
  ImportCodingConceptsDto,
  ListConceptsQueryDto,
  ListCodingSystemsQueryDto,
} from './dto/coding.dto';

@Controller('coding-systems')
export class CodingController {
  constructor(private readonly coding: CodingService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create an org coding system (e.g. ICD-10, SNOMED CT)',
    operationId: 'codingSystemsCreate',
    permissions: [PERMISSION_GROUPS.codings.manage],
    statusCode: 201,
    responseType: CodingSystemResponseDto,
  })
  create(@Body() body: CreateCodingSystemDto) {
    return this.coding.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List coding systems',
    operationId: 'codingSystemsList',
    permissions: [PERMISSION_GROUPS.codings.read],
    responseType: ListCodingSystemsQueryDto,
  })
  list(@Query() query: ListCodingSystemsQueryDto) {
    return this.coding.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a coding system',
    operationId: 'codingSystemsGet',
    permissions: [PERMISSION_GROUPS.codings.read],
    responseType: CodingSystemResponseDto,
  })
  get(@Param('id') id: string) {
    return this.coding.get(id);
  }

  @Post(':id/import')
  @ApiEndpoint({
    summary: 'Idempotently import concepts into a coding system',
    operationId: 'codingSystemsImport',
    permissions: [PERMISSION_GROUPS.codings.manage],
    statusCode: 201,
    responseType: CodingImportResultDto,
  })
  import(@Param('id') id: string, @Body() body: ImportCodingConceptsDto) {
    return this.coding.import(id, body);
  }

  @Get(':id/concepts')
  @ApiEndpoint({
    summary: 'Search concepts within a coding system',
    operationId: 'codingSystemsListConcepts',
    permissions: [PERMISSION_GROUPS.codings.read],
    responseType: CodeConceptResponseDto,
  })
  listConcepts(@Param('id') id: string, @Query() query: ListConceptsQueryDto) {
    return this.coding.listConcepts(id, query);
  }
}