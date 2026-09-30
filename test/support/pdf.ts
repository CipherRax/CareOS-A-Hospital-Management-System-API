/**
 * The two PDF surfaces transport their bytes differently: the document-job
 * endpoint returns a raw `Buffer` (serialised as `{ type: 'Buffer', data }`),
 * while a report export is stored as text and base64-encoded, so its download
 * returns a string. Both are valid; this normalises either to bytes so the
 * assertions below can be written once.
 */
export function toBytes(artifact: unknown): Buffer {
  if (Buffer.isBuffer(artifact)) return artifact;
  if (typeof artifact === 'string') return Buffer.from(artifact, 'base64');
  if (Array.isArray(artifact)) return Buffer.from(artifact as number[]);
  if (artifact && typeof artifact === 'object') {
    const data = (artifact as { data?: unknown }).data;
    if (Array.isArray(data)) return Buffer.from(data as number[]);
  }
  throw new Error(`Cannot read PDF bytes from ${JSON.stringify(artifact)?.slice(0, 80)}`);
}

/**
 * Assertions for a PDF produced by the document renderer.
 *
 * A byte-length check proves almost nothing: a truncated or hand-rolled
 * "PDF" would pass it. These assertions pin the properties that make the
 * artifact usable by someone downstream:
 *
 *  - a real PDF header and trailer, so the file is neither mislabelled nor
 *    truncated;
 *  - `FontFile2`, meaning a font is actually embedded rather than referenced.
 *    A renderer that leans on the viewer's base-14 fonts produces a document
 *    that opens but re-flows and drops non-Latin-1 characters on the reader's
 *    machine, which is precisely the bug this replaced;
 *  - `ToUnicode`, meaning the text is extractable and searchable. Without it
 *    the bytes are readable on screen but useless to anything that indexes,
 *    copies or archives the document.
 *
 * These are deliberately structural rather than textual: asserting on specific
 * words couples the test to the renderer's layout choices, whereas these hold
 * for every document the service will ever produce.
 */
export function expectRenderedPdf(artifact: unknown): Buffer {
  const bytes = toBytes(artifact);
  const header = bytes.subarray(0, 5).toString('latin1');
  if (header !== '%PDF-') {
    throw new Error(`Not a PDF: expected a %PDF- header, got ${JSON.stringify(header)}`);
  }
  const raw = bytes.toString('latin1');
  if (!raw.includes('%%EOF')) {
    throw new Error('PDF has no %%EOF trailer, so it is truncated');
  }
  if (!raw.includes('/FontFile2')) {
    throw new Error('PDF has no embedded font (FontFile2); it relies on viewer fonts');
  }
  if (!raw.includes('/ToUnicode')) {
    throw new Error('PDF has no ToUnicode CMap, so its text cannot be extracted');
  }
  return bytes;
}
