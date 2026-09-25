import { Body, Controller, Post } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { RenderDocumentPdfDto } from './dto/document-job.dto';
import { DocumentJobsService } from './document-jobs.service';

@Controller('document-jobs')
export class DocumentJobsController {
  constructor(private readonly documentJobs: DocumentJobsService) {}

  @Post('pdf')
  @ApiEndpoint({
    summary: 'Render a minimal PDF document job',
    operationId: 'documentJobsRenderPdf',
    permissions: [PERMISSION_GROUPS.notifications.manage],
    errors: [
      { status: 400, description: 'Unsupported document kind or invalid content' },
    ],
  })
  renderPdf(@Body() body: RenderDocumentPdfDto) {
    return this.documentJobs.renderPdf(body);
  }
}
