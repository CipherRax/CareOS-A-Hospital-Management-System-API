import { renderTextPdf } from '../../../src/jobs/pdf/pdf-renderer';

describe('renderTextPdf', () => {
  it('produces a single-page PDF 1.4 document with escaped text and an xref', () => {
    const pdf = renderTextPdf({
      title: 'Report (final) \\ draft',
      lines: ['Reference: report-1', 'A literal (token)'],
      meta: { kind: 'invoice' },
    });
    const source = pdf.toString('utf8');

    expect(pdf.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    expect(source.endsWith('%%EOF')).toBe(true);
    expect(source).toContain('(Report \\(final\\) \\\\ draft) Tj');
    expect(source).toContain('(Reference: report-1) Tj');
    expect(source).toContain('(A literal \\(token\\)) Tj');
    expect(source).toContain('/Type /Catalog');
    expect(source).toContain('/Type /Page');
    expect(source).toContain('/BaseFont /Helvetica');
    expect(source).toContain('xref');
    expect(source).toMatch(/startxref\n\d+\n%%EOF$/);
  });
});
