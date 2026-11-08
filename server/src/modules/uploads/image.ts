// Checks an uploaded picture by its bytes (never its name or declared type) and rewrites it without
// metadata (docs/CASE_QUESTIONS_PLAN.md C7). Pure and dependency-free: the container stays small and
// has no native image library. What is kept is only what the browser needs to draw the picture; EXIF
// (camera, GPS), XMP, text comments and anything after the image's end are dropped.

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface CleanImage {
  mime: ImageMime;
  width: number;
  height: number;
  data: Buffer;
}

/** Largest file accepted, in bytes (also a CHECK constraint). */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** Larger pictures are refused: browsers would need too much memory to draw them. */
export const MAX_SIDE = 8000;
export const MAX_PIXELS = 40_000_000;

class BadImage extends Error {}
const bad = (message: string): never => {
  throw new BadImage(message);
};

/** The cleaned picture, or a problem in words. */
export function sanitizeImage(input: Buffer): CleanImage | { problem: string } {
  try {
    if (input.length === 0) return { problem: "The file is empty." };
    if (input.length > UPLOAD_MAX_BYTES) return { problem: "The picture is larger than 2 MB." };
    const image = isPng(input)
      ? cleanPng(input)
      : isJpeg(input)
        ? cleanJpeg(input)
        : isWebp(input)
          ? cleanWebp(input)
          : bad("Upload a PNG, JPEG or WebP picture.");
    if (image.width < 1 || image.height < 1) bad("The picture has no size.");
    if (image.width > MAX_SIDE || image.height > MAX_SIDE || image.width * image.height > MAX_PIXELS)
      bad(`The picture is too large: at most ${MAX_SIDE} pixels on each side.`);
    return image;
  } catch (err) {
    if (err instanceof BadImage) return { problem: err.message };
    // Reading past the end of a truncated file (RangeError) means the file is broken.
    if (err instanceof RangeError) return { problem: "The picture file is damaged." };
    /* v8 ignore next -- nothing else is thrown by Buffer reads */
    throw err;
  }
}

// ─────────────────────────────── PNG ───────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE);

/** Chunks needed to draw the picture (critical ones, colour and transparency). Text, EXIF and time are dropped. */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "pHYs",
  "bKGD",
]);

function cleanPng(b: Buffer): CleanImage {
  const parts: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawData = false;
  let first = true;
  for (;;) {
    if (offset + 12 > b.length) bad("The picture file is damaged.");
    const length = b.readUInt32BE(offset);
    const type = b.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > b.length) bad("The picture file is damaged.");
    if (first) {
      if (type !== "IHDR" || length !== 13) bad("The picture file is damaged.");
      width = b.readUInt32BE(offset + 8);
      height = b.readUInt32BE(offset + 12);
      first = false;
    }
    if (type === "IDAT") sawData = true;
    if (PNG_KEEP.has(type)) parts.push(b.subarray(offset, end));
    offset = end;
    if (type === "IEND") break; // anything after the end is not part of the picture
  }
  if (!sawData) bad("The picture file is damaged.");
  return { mime: "image/png", width, height, data: Buffer.concat(parts) };
}

// ─────────────────────────────── JPEG ───────────────────────────────

const isJpeg = (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Start-of-frame markers (C0–CF without DHT C4, JPG C8 and DAC CC): they hold the size. */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** Segments kept before the image data: tables, frame, restart interval, JFIF (APP0), ICC (APP2), Adobe (APP14). */
function keepJpegSegment(marker: number, body: Buffer): boolean {
  if (marker === 0xdb || marker === 0xc4 || marker === 0xdd || isSof(marker)) return true;
  if (marker === 0xe0) return body.toString("latin1", 0, 4) === "JFIF";
  if (marker === 0xe2) return body.toString("latin1", 0, 12) === "ICC_PROFILE\0";
  if (marker === 0xee) return body.toString("latin1", 0, 5) === "Adobe";
  return false; // APP1 (EXIF, XMP), APP13 (IPTC), comments and the rest
}

function cleanJpeg(b: Buffer): CleanImage {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let offset = 2;
  let width = 0;
  let height = 0;
  for (;;) {
    if (offset + 4 > b.length) bad("The picture file is damaged.");
    if (b[offset] !== 0xff) bad("The picture file is damaged.");
    const marker = b[offset + 1] as number;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01)
      bad("The picture file is damaged.");
    const length = b.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > b.length) bad("The picture file is damaged.");
    const body = b.subarray(offset + 4, end);
    if (isSof(marker)) {
      if (body.length < 5) bad("The picture file is damaged.");
      height = body.readUInt16BE(1);
      width = body.readUInt16BE(3);
    }
    if (marker === 0xda) {
      // Start of scan: the compressed data follows. Keep it up to the last end-of-image marker
      // (progressive pictures have several scans), dropping anything appended after it.
      const eoi = b.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi < end) bad("The picture file is damaged.");
      parts.push(b.subarray(offset, eoi + 2));
      break;
    }
    if (keepJpegSegment(marker, body)) parts.push(b.subarray(offset, end));
    offset = end;
  }
  if (!width || !height) bad("The picture file is damaged.");
  return { mime: "image/jpeg", width, height, data: Buffer.concat(parts) };
}

// ─────────────────────────────── WebP ───────────────────────────────

const isWebp = (b: Buffer) =>
  b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP";

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function cleanWebp(b: Buffer): CleanImage {
  const riffEnd = Math.min(b.length, 8 + b.readUInt32LE(4));
  const parts: Buffer[] = [];
  let offset = 12;
  let width = 0;
  let height = 0;
  while (offset + 8 <= riffEnd) {
    const type = b.toString("latin1", offset, offset + 4);
    const size = b.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2); // chunks are padded to an even length
    if (offset + 8 + size > riffEnd) bad("The picture file is damaged.");
    const body = b.subarray(offset + 8, offset + 8 + size);
    if (WEBP_KEEP.has(type)) {
      let chunk = b.subarray(offset, Math.min(end, riffEnd));
      if (type === "VP8X") {
        if (size < 10) bad("The picture file is damaged.");
        // The header announces EXIF/XMP chunks: clear those flags, as the chunks are dropped.
        chunk = Buffer.from(chunk);
        chunk[8] = (chunk[8] as number) & ~(VP8X_EXIF | VP8X_XMP);
        width = body.readUIntLE(4, 3) + 1;
        height = body.readUIntLE(7, 3) + 1;
      } else if (type === "VP8 " && !width) {
        if (size < 10 || body[3] !== 0x9d || body[4] !== 0x01 || body[5] !== 0x2a) bad("The picture file is damaged.");
        width = body.readUInt16LE(6) & 0x3fff;
        height = body.readUInt16LE(8) & 0x3fff;
      } else if (type === "VP8L" && !width) {
        if (size < 5 || body[0] !== 0x2f) bad("The picture file is damaged.");
        const bits = body.readUInt32LE(1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      }
      parts.push(chunk.length % 2 ? Buffer.concat([chunk, Buffer.alloc(1)]) : chunk);
    }
    offset = end;
  }
  if (!width || !height) bad("The picture file is damaged.");
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return { mime: "image/webp", width, height, data: Buffer.concat([header, body]) };
}
