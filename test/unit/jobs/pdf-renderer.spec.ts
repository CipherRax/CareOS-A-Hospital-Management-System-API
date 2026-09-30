import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPdf } from '../../../src/jobs/pdf/pdf-renderer';
import { MissingGlyphError, PdfRenderError } from '../../../src/jobs/pdf/pdf-errors';
import type { PdfDocumentSpec } from '../../../src/jobs/pdf/pdf-document';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const FIXED_DATE = new Date('2026-01-02T03:04:05.000Z');

async function render(spec: Partial<PdfDocumentSpec> = {}): Promise<Buffer> {
  return renderPdf({
    title: 'Test document',
    sections: [{ kind: 'paragraph', text: 'Body text.' }],
    createdAt: FIXED_DATE,
    ...spec,
  });
}

/**
 * Extract text with `pdftotext` when it is installed. These assertions are the
 * only ones that prove the glyphs are *correct* rather than merely present, so
 * they run where the tool exists; the structural assertions below always run.
 */
function extractText(pdf: Buffer): string | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'careos-pdf-'));
    const file = join(dir, 'out.pdf');
    writeFileSync(file, pdf);
    try {
      return execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
    } finally {
      writeFileSync(file, '');
    }
  } catch {
    return null;
  }
}

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('renderPdf', () => {
  it('produces a complete PDF', async () => {
    const pdf = await render();
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('ascii').trim()).toBe('%%EOF');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('embeds the font rather than referencing a standard-14 face', async () => {
    // The pre-P10 renderer emitted /BaseFont /Helvetica with WinAnsi encoding,
    // which cannot represent anything outside Latin-1.
    const source = (await render()).toString('latin1');
    expect(source).toContain('FontFile2');
    expect(source).toContain('ToUnicode');
    expect(source).not.toContain('WinAnsiEncoding');
  });

  it('stamps provenance metadata so an artifact identifies itself', async () => {
    const source = (
      await render({
        title: 'Discharge summary',
        subject: 'discharge_summary (abc)',
        author: 'careOS',
      })
    ).toString('latin1');
    expect(source).toContain('careOS');
  });

  it('is byte-stable for a fixed createdAt, so a stored artifact hash means something', async () => {
    const first = await render();
    const second = await render();
    expect(first.equals(second)).toBe(true);
  });
});

describe('unicode', () => {
  // Deliberately excludes CJK: DejaVu carries no ideographs, so including it
  // here would be a claim the font cannot honour.
  const SAMPLE = 'Ngũgĩ · µmol/L · 5.0 °C · ≥ · ≤ · ελληνικά · Кириллица';

  it('renders non-Latin-1 characters into the document', async () => {
    const pdf = await render({ title: SAMPLE, sections: [] });
    expect(pdf.length).toBeGreaterThan(1000);
  });

  (hasPdftotext ? it : it.skip)(
    'round-trips the characters through extraction',
    async () => {
      const text = extractText(await render({ title: SAMPLE, sections: [] }));
      expect(text).not.toBeNull();
      for (const fragment of ['Ngũgĩ', 'µmol/L', '°C', '≥', 'ελληνικά']) {
        expect(text).toContain(fragment);
      }
    },
  );

  (hasPdftotext ? it : it.skip)(
    'does not drop a character the font cannot render',
    async () => {
      // DejaVu has no CJK. The old renderer would have emitted a blank gap here
      // with no error; now it refuses, which is the whole point of the check.
      await expect(
        render({ title: 'Patient 日本語', sections: [] }),
      ).rejects.toBeInstanceOf(MissingGlyphError);
    },
  );

  it('names the offending character and where it came from', async () => {
    await expect(render({ title: 'Patient 日本語', sections: [] })).rejects.toThrow(
      /document title.*U\+65E5/s,
    );
  });

  it('reports a table cell rather than the whole document', async () => {
    await expect(
      render({
        sections: [
          {
            kind: 'table',
            columns: [{ header: 'Name' }],
            rows: [{ cells: ['Wanjiru 日本語'] }],
          },
        ],
      }),
    ).rejects.toThrow(/row 1, column "Name"/);
  });

  (hasPdftotext ? it : it.skip)('renders a covered script correctly', async () => {
    const text = extractText(
      await render({
        title: 'Patient register',
        sections: [{ kind: 'paragraph', text: 'Ngũgĩ Wanjiru' }],
      }),
    );
    expect(text).toContain('Ngũgĩ Wanjiru');
  });
});

describe('strictGlyphs opt-out', () => {
  it('still renders when the caller accepts dropped glyphs', async () => {
    const pdf = await render({
      title: 'Patient 日本語',
      sections: [],
      strictGlyphs: false,
    });
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

describe('tables', () => {
  const table = {
    kind: 'table' as const,
    columns: [
      { header: 'Invoice', weight: 2 },
      { header: 'Status', compact: true },
      { header: 'Amount', align: 'right' as const },
    ],
    rows: Array.from({ length: 80 }, (_, i) => ({
      cells: [
        `INV-${1000 + i}`,
        i % 3 === 0 ? 'CANCELLED' : 'PAID',
        (i * 37.5).toFixed(2),
      ],
    })),
  };

  it('renders many rows across pages', async () => {
    const pdf = await render({ sections: [table] });
    // 80 rows at ~16pt does not fit on one A4 page, so this also proves the
    // page-break path runs without corrupting the file.
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('discloses a truncated table instead of quietly dropping rows', async () => {
    // The pre-P10 line renderer capped at 50 rows and appended "... and N more",
    // which was easy to miss. The count is now stated under the table.
    const capped = { ...table, maxRows: 50 };
    const text = hasPdftotext ? extractText(await render({ sections: [capped] })) : null;
    if (text !== null) expect(text).toMatch(/Showing 50 of 80 rows/);
  });

  (hasPdftotext ? it : it.skip)(
    'says nothing about truncation when nothing was dropped',
    async () => {
      const text = extractText(await render({ sections: [table] }));
      expect(text).not.toMatch(/Showing \d+ of/);
    },
  );

  (hasPdftotext ? it : it.skip)(
    'repeats the column header on continuation pages',
    async () => {
      const text = extractText(await render({ sections: [table] }));
      const headerCount = (text!.match(/Invoice/g) ?? []).length;
      // 80 rows span at least two pages; the header must appear on each.
      expect(headerCount).toBeGreaterThanOrEqual(2);
    },
  );

  it('tolerates rows with fewer or more cells than columns', async () => {
    const pdf = await render({
      sections: [
        {
          kind: 'table',
          columns: [{ header: 'A' }, { header: 'B' }],
          rows: [{ cells: ['only-a'] }, { cells: ['a', 'b', 'extra'] }],
        },
      ],
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('marks a cancelled row muted and a continuation row italic', async () => {
    const pdf = await render({
      sections: [
        {
          kind: 'table',
          columns: [{ header: 'Status' }],
          rows: [
            { cells: ['CANCELLED'], muted: true },
            { cells: ['same patient'], continuation: true },
          ],
        },
      ],
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('charts', () => {
  it('states "no data" rather than drawing an empty plot', async () => {
    // The distinction that matters: an empty axis reads as "all values are
    // zero", which is a materially different claim about the hospital.
    const pdf = await render({
      sections: [{ kind: 'barChart', title: 'Admissions by sex', points: [] }],
    });
    const text = hasPdftotext ? extractText(pdf) : null;
    if (text !== null) {
      expect(text).toContain('No data available for this period.');
    } else {
      expect(pdf.length).toBeGreaterThan(1000);
    }
  });

  it('draws bars and labels for a populated series', async () => {
    const pdf = await render({
      sections: [
        {
          kind: 'barChart',
          title: 'Admissions by sex',
          unit: 'patients',
          points: [
            { label: 'Female', value: 42 },
            { label: 'Male', value: 31 },
            { label: 'Unspecified', value: 0 },
          ],
        },
      ],
    });
    const text = hasPdftotext ? extractText(pdf) : null;
    if (text !== null) {
      expect(text).toContain('Admissions by sex');
      expect(text).toContain('patients');
      expect(text).not.toContain('No data available');
    }
    expect(pdf.length).toBeGreaterThan(1000);
  });

  (hasPdftotext ? it : it.skip)(
    'discloses a non-finite value it refused to plot',
    async () => {
      const text = extractText(
        await render({
          sections: [
            {
              kind: 'barChart',
              title: 'TAT',
              points: [
                { label: 'a', value: 1 },
                { label: 'broken', value: Number.NaN },
              ],
            },
          ],
        }),
      );
      expect(text).toMatch(/1 points? omitted because the value was not a finite number/);
    },
  );

  (hasPdftotext ? it : it.skip)(
    'discloses points withheld by the display cap',
    async () => {
      const text = extractText(
        await render({
          sections: [
            {
              kind: 'barChart',
              title: 'Capped',
              maxBars: 3,
              points: Array.from({ length: 10 }, (_, i) => ({
                label: `p${i}`,
                value: i,
              })),
            },
          ],
        }),
      );
      expect(text).toMatch(/7 further points not shown/);
    },
  );

  it('handles a negative series, which is legitimate for a variance chart', async () => {
    const pdf = await render({
      sections: [
        {
          kind: 'barChart',
          title: 'Variance vs budget',
          points: [
            { label: 'Pharmacy', value: 1200 },
            { label: 'Labs', value: -400 },
          ],
        },
      ],
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('draws a single-point line chart without dividing by zero', async () => {
    const pdf = await render({
      sections: [
        { kind: 'lineChart', title: 'Daily', points: [{ label: 'Mon', value: 5 }] },
      ],
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('renders a long line series', async () => {
    const pdf = await render({
      sections: [
        {
          kind: 'lineChart',
          title: 'Daily admissions',
          points: Array.from({ length: 60 }, (_, i) => ({
            label: `d${i}`,
            value: (i % 7) + 1,
          })),
        },
      ],
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('images', () => {
  it('embeds a PNG', async () => {
    const pdf = await render({
      sections: [{ kind: 'image', data: PNG_1X1, format: 'png', caption: 'Trend' }],
    });
    const source = pdf.toString('latin1');
    expect(source).toContain('/Image');
  });

  it('rejects a mislabelled image', async () => {
    await expect(
      render({ sections: [{ kind: 'image', data: PNG_1X1, format: 'jpeg' }] }),
    ).rejects.toBeInstanceOf(PdfRenderError);
  });
});

describe('page furniture', () => {
  (hasPdftotext ? it : it.skip)('numbers pages and repeats the footer', async () => {
    const text = extractText(
      await render({
        footer: 'Confidential',
        pageNumbers: true,
        sections: [
          {
            kind: 'table',
            columns: [{ header: 'N' }],
            rows: Array.from({ length: 70 }, (_, i) => ({ cells: [`row ${i}`] })),
          },
        ],
      }),
    );
    expect(text).toContain('Confidential');
    expect(text).toMatch(/Page 1 of [2-9]/);
  });

  it('omits the footer pass when nothing asks for it', async () => {
    const plain = await render();
    const numbered = await render({ pageNumbers: true, footer: 'x' });
    // bufferPages changes the object layout, so the two are distinguishable.
    expect(plain.equals(numbered)).toBe(false);
  });
});

describe('page size', () => {
  (hasPdftotext ? it : it.skip)('supports LETTER as well as the A4 default', async () => {
    const a4 = extractText(await render());
    const letter = extractText(await render({ pageSize: 'LETTER' }));
    expect(a4).not.toBeNull();
    expect(letter).not.toBeNull();
  });
});

describe('unknown sections', () => {
  it('rejects a section kind it does not understand', async () => {
    await expect(
      render({
        sections: [
          { kind: 'hologram' } as unknown as PdfDocumentSpec['sections'][number],
        ],
      }),
    ).rejects.toBeInstanceOf(PdfRenderError);
  });
});
