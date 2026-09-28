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

  @Post(':id/rescan')
  @ApiEndpoint({
    summary: 'Re-queue the content scan for an uploaded document',
    description:
      'Resets the document to PENDING and republishes Storage.DocumentUploaded, making it ' +
      'unservable for the duration. Covers rows uploaded before any scanner existed and ' +
      'scans that failed with an engine outage. The document becomes downloadable again ' +
      'only on a CLEAN or FLAGGED verdict.',
    operationId: 'documentsRescan',
    permissions: [PERMISSION_GROUPS.documents.create],
    responseType: DocumentResponseDto,
    errors: [
      { status: 404, description: 'Document not found' },
      { status: 409, description: 'Wrong workflow state (not uploaded)' },
    ],
  })
  rescan(@Param('id') id: string) {
    return this.documents.rescan(id);
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
    description:
      'Refused until the content scan has cleared the document: 409 while the verdict is ' +
      'PENDING or ERROR, 422 when it is INFECTED or REJECTED. FLAGGED is downloadable.',
    operationId: 'documentsDownload',
    permissions: [PERMISSION_GROUPS.documents.read],
    responseType: DownloadResponseDto,
    errors: [
      { status: 409, description: 'Document not uploaded, or content scan has not cleared it' },
      { status: 422, description: 'Document refused by the content scan (infected/rejected)' },
    ],
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