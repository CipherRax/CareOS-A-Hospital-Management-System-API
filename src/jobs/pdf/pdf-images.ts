/**
 * Image introspection for PDF embedding: enough of PNG and JPEG to know an
 * image's real pixel dimensions before drawing it.
 *
 * Why not let PDFKit work it out: PDFKit's `fit` scales an image up to fill the
 * box, which turns a 64×64 logo into a blurry 400×400 block. A report should
 * show its own assets at their intended size. Reading the header also lets the
 * renderer reject an image whose dimensions or byte count are unreasonable
 * *before* the bytes go into the document.
 */
import { PdfRenderError } from './pdf-errors';

export interface ImageSize {
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Refuse anything larger than this; a report is not a photo gallery. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** A single image may not exceed this on its longer edge, in pixels. */
export const MAX_IMAGE_PIXELS = 6000;

export function inspectImage(data: Buffer, declared?: 'png' | 'jpeg'): ImageSize {
  if (data.length === 0) throw new PdfRenderError('Cannot embed an empty image buffer.');
  if (data.length > MAX_IMAGE_BYTES) {
    throw new PdfRenderError(
      `Image is ${data.length} bytes, over the ${MAX_IMAGE_BYTES}-byte limit for an embedded image.`,
    );
  }
  const format = detectFormat(data);
  if (!format) {
    throw new PdfRenderError(
      'Unsupported image format: only PNG and JPEG can be embedded.',
    );
  }
  // A caller that labels an image incorrectly has a bug; PDFKit would guess
  // from the bytes and hide it.
  if (declared && declared !== format) {
    throw new PdfRenderError(
      `Image declared as ${declared} but its bytes are ${format.toUpperCase()}.`,
    );
  }
  const size = format === 'png' ? readPngSize(data) : readJpegSize(data);
  if (!size)
    throw new PdfRenderError(`Could not read ${format.toUpperCase()} image dimensions.`);
  const longer = Math.max(size.width, size.height);
  if (longer > MAX_IMAGE_PIXELS) {
    throw new PdfRenderError(
      `Image is ${size.width}×${size.height}px, over the ${MAX_IMAGE_PIXELS}px limit.`,
    );
  }
  return { ...size, format };
}

function detectFormat(data: Buffer): 'png' | 'jpeg' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  // JPEG SOI marker.
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'jpeg';
  return null;
}

function readPngSize(data: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then the first chunk is always IHDR: length(4) type(4) w(4) h(4)
  if (data.length < 24) return null;
  if (data.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function readJpegSize(data: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1] as number;
    // Padding and standalone markers carry no length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = data.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > data.length) return null;
      // height(2) precision(1) width(2)
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

/**
 * Scale to fit inside a box without ever enlarging. Returns the drawn size in
 * points, and a `fit` flag so the caller can centre a small image rather than
 * stretching it.
 */
export function fitWithin(
  natural: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number; scaled: boolean } {
  if (natural.width <= 0 || natural.height <= 0) {
    return { width: box.width, height: box.height, scaled: false };
  }
  const scale = Math.min(box.width / natural.width, box.height / natural.height, 1);
  return {
    width: natural.width * scale,
    height: natural.height * scale,
    scaled: scale < 1,
  };
}
