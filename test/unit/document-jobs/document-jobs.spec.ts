import {
  DOCUMENT_JOB_KINDS,
  RenderDocumentPdfSchema,
} from '../../../src/modules/document-jobs/dto/document-job.dto';

describe('document job PDF kinds', () => {
  it.each(DOCUMENT_JOB_KINDS)('accepts %s', (kind) => {
    const result = RenderDocumentPdfSchema.safeParse({
      kind,
      resourceId: 'resource-1',
      title: 'Document',
      lines: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects kinds outside the allowlist', () => {
    const result = RenderDocumentPdfSchema.safeParse({
      kind: 'clinical_note',
      resourceId: 'resource-1',
      title: 'Document',
      lines: [],
    });
    expect(result.success).toBe(false);
  });
});
