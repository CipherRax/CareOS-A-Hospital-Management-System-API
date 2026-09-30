import {
  fitWithin,
  inspectImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
} from '../../../src/jobs/pdf/pdf-images';
import { PdfRenderError } from '../../../src/jobs/pdf/pdf-errors';

/** Smallest valid PNG: 1x1, 8-bit RGBA. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A JPEG with an SOF0 segment declaring 8x8. */
const JPEG_8X8 = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from([0x00, 0x10]),
  Buffer.from('JFIF\0', 'ascii'),
  Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  // SOI for a new frame, then SOF0: len(2) precision(1) height(2) width(2) comps(1)
  Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03, 0x01, 0x11, 0x00,
  ]),
  Buffer.from([0xff, 0xd9]),
]);

describe('inspectImage', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(inspectImage(PNG_1X1)).toEqual({ width: 1, height: 1, format: 'png' });
  });

  it('reads JPEG dimensions from the start-of-frame segment', () => {
    expect(inspectImage(JPEG_8X8).format).toBe('jpeg');
    expect(inspectImage(JPEG_8X8).width).toBe(8);
    expect(inspectImage(JPEG_8X8).height).toBe(8);
  });

  it('rejects an empty buffer', () => {
    expect(() => inspectImage(Buffer.alloc(0))).toThrow(PdfRenderError);
  });

  it('rejects a format it cannot embed', () => {
    const gif = Buffer.from('GIF89a' + '\0'.repeat(32), 'binary');
    expect(() => inspectImage(gif)).toThrow(/only PNG and JPEG/);
  });

  it('rejects a mislabelled image rather than guessing', () => {
    // PDFKit would sniff the bytes and render it, hiding the caller's bug.
    expect(() => inspectImage(PNG_1X1, 'jpeg')).toThrow(/declared as jpeg/i);
    expect(() => inspectImage(JPEG_8X8, 'png')).toThrow(/declared as png/i);
  });

  it('accepts a correct label', () => {
    expect(inspectImage(PNG_1X1, 'png').format).toBe('png');
  });

  it('refuses an image over the byte cap', () => {
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => inspectImage(big)).toThrow(/over the .*byte limit/);
  });

  it('refuses an image with an unreasonable edge length', () => {
    // A valid PNG header claiming 9000x9000 — a decompression-bomb shape.
    const bomb = Buffer.from(PNG_1X1);
    bomb.writeUInt32BE(9000, 16);
    bomb.writeUInt32BE(9000, 20);
    expect(() => inspectImage(bomb)).toThrow(/over the .*px limit/);
    expect(MAX_IMAGE_PIXELS).toBe(6000);
  });

  it('rejects a truncated JPEG it cannot measure', () => {
    const truncated = Buffer.from([0xff, 0xd8, 0xff]);
    expect(() => inspectImage(truncated)).toThrow(/dimensions|Could not read/);
  });
});

describe('fitWithin', () => {
  it('scales a large image down to the box', () => {
    const fitted = fitWithin({ width: 2000, height: 1000 }, { width: 100, height: 100 });
    expect(fitted.width).toBeCloseTo(100, 6);
    expect(fitted.height).toBeCloseTo(50, 6);
    expect(fitted.scaled).toBe(true);
  });

  it('never enlarges a small image, which would just blur it', () => {
    const fitted = fitWithin({ width: 32, height: 32 }, { width: 400, height: 400 });
    expect(fitted.width).toBe(32);
    expect(fitted.height).toBe(32);
    expect(fitted.scaled).toBe(false);
  });

  it('preserves aspect ratio', () => {
    const fitted = fitWithin({ width: 1000, height: 500 }, { width: 200, height: 400 });
    expect(fitted.height).toBeCloseTo(100, 6);
  });

  it('falls back to the box for a degenerate image', () => {
    const fitted = fitWithin({ width: 0, height: 0 }, { width: 50, height: 60 });
    expect(fitted).toEqual({ width: 50, height: 60, scaled: false });
  });
});
