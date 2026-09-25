export interface TextPdfOptions {
  title: string;
  lines: string[];
  meta?: Record<string, string>;
}

export function renderTextPdf(opts: TextPdfOptions): Buffer {
  const textLines = [
    opts.title,
    ...Object.entries(opts.meta ?? {}).map(([key, value]) => `${key}: ${value}`),
    ...opts.lines,
  ];
  const commands = ['BT', '/F1 12 Tf', '14 TL', '50 742 Td'];
  for (const [index, line] of textLines.entries()) {
    commands.push(`${index === 0 ? '' : 'T*\n'}(${escapePdfText(line)}) Tj`);
  }
  commands.push('ET');
  const stream = Buffer.from(`${commands.join('\n')}\n`, 'utf8');

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let position = 0;
  const append = (value: string | Buffer): void => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    chunks.push(chunk);
    position += chunk.length;
  };
  const appendObject = (number: number, body: string | Buffer): void => {
    offsets[number] = position;
    append(`${number} 0 obj\n`);
    append(body);
    append('\nendobj\n');
  };

  append('%PDF-1.4\n');
  appendObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  appendObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  appendObject(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  );
  appendObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  offsets[5] = position;
  append(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n`);
  append(stream);
  append('\nendstream\nendobj\n');

  const xrefOffset = position;
  append('xref\n0 6\n');
  append('0000000000 65535 f \n');
  for (let number = 1; number <= 5; number += 1) {
    append(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  }
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.concat(chunks);
}

function escapePdfText(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
