import { Injectable } from '@nestjs/common';
import { AuditService } from '../../database/audit.service';
import { renderTextPdf } from '../../jobs/pdf/pdf-renderer';
import type { RenderDocumentPdfDto } from './dto/document-job.dto';

@Injectable()
export class DocumentJobsService {
  constructor(private readonly audit: AuditService) {}

  async renderPdf(input: RenderDocumentPdfDto) {
    const pdf = renderTextPdf({
      title: input.title,
      lines: input.lines,
    });
    const byteLength = pdf.length;
    await this.audit.record({
      action: 'pdf.rendered',
      resource: 'DocumentJob',
      resourceId: input.resourceId,
      newState: {
        kind: input.kind,
        resourceId: input.resourceId,
        byteLength,
      },
    });
    return {
      pdf,
      byteLength,
      contentType: 'application/pdf' as const,
    };
  }
}
