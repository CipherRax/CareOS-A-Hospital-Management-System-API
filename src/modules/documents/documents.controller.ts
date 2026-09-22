import { Body, Controller, Get, Param, Post, Query, Delete } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DocumentsService } from './documents.service';
import {
  DocumentResponseDto,
  DownloadResponseDto,
  InitiateUploadDto,
  InitiateUploadResponseDto,
  ListDocumentsQueryDto,
} from './dto/documents.dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Initiate an upload — returns a presigned PUT URL for direct client upload',
    operationId: 'documentsInitiate',
    permissions: [PERMISSION_GROUPS.documents.create],
    responseType: InitiateUploadResponseDto,
    statusCode: 201,
    errors: [
      { status: 503, description: 'Object storage not configured' },
      { status: 415, description: 'Unsupported content type' },
    ],
  })
  initiate(@Body() body: InitiateUploadDto) {
    return this.documents.initiate(body);
  }

  @Post(':id/complete')
  @ApiEndpoint({
    summary: 'Confirm a client finished uploading; finalises the document row',
    operationId: 'documentsComplete',
    permissions: [PERMISSION_GROUPS.documents.create],
    responseType: DocumentResponseDto,
    errors: [
      { status: 404, description: 'Document not found' },
      { status: 409, description: 'Wrong workflow state (not pending)' },
      { status: 503, description: 'File missing from storage, or storage unavailable' },
    ],
  })
  complete(@Param('id') id: string) {
    return this.documents.complete(id);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List documents (filter by status, paginated)',
    operationId: 'documentsList',
    permissions: [PERMISSION_GROUPS.documents.read],
    responseType: DocumentResponseDto,
    okResponse: { isArray: true },
  })
  list(@Query() query: ListDocumentsQueryDto) {
    return this.documents.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get document metadata',
    operationId: 'documentsGet',
    permissions: [PERMISSION_GROUPS.documents.read],
    responseType: DocumentResponseDto,
  })
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }

  @Get(':id/download')
  @ApiEndpoint({
    summary: 'Get a presigned GET URL to download the file directly',
    operationId: 'documentsDownload',
    permissions: [PERMISSION_GROUPS.documents.read],
    responseType: DownloadResponseDto,
  })
  download(@Param('id') id: string) {
    return this.documents.downloadUrl(id);
  }

  @Delete(':id')
  @ApiEndpoint({
    summary: 'Delete a document (removes the object and soft-deletes the row)',
    operationId: 'documentsDelete',
    permissions: [PERMISSION_GROUPS.documents.manage],
    statusCode: 204,
  })
  async remove(@Param('id') id: string) {
    await this.documents.remove(id);
  }
}