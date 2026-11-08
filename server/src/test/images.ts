import { crc32, deflateSync } from "node:zlib";

// Tiny pictures built in code for tests (no binary fixtures). The PNG is a real, decodable picture;
// the JPEG and WebP have the right structure for the sanitizer (it never decodes pixels).

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A width × height grey PNG, optionally with a text chunk (metadata) and bytes after its end. */
export function png(width = 2, height = 2, opts: { text?: string; trailer?: string } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter byte per row
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...(opts.text ? [pngChunk("tEXt", Buffer.from(`Comment\0${opts.text}`, "latin1"))] : []),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
    Buffer.from(opts.trailer ?? "", "latin1"),
  ]);
}

function jpegSegment(marker: number, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/** A JPEG-shaped file of the given size, with an EXIF segment carrying `exif` and a comment. */
export function jpeg(width = 3, height = 2, exif = "GPS 52.1,4.3"): Buffer {
  const sof = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    jpegSegment(0xe1, Buffer.from(`Exif\0\0${exif}`, "latin1")),
    jpegSegment(0xfe, Buffer.from("made with a camera", "latin1")),
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(0xc0, sof),
    jpegSegment(0xc4, Buffer.alloc(20, 0)),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A lossless WebP-shaped file (VP8X + VP8L) with an EXIF chunk carrying `exif`. */
export function webp(width = 4, height = 3, exif = "GPS 52.1,4.3"): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "latin1");
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08; // EXIF flag
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const vp8l = Buffer.alloc(6);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  const body = Buffer.concat([
    Buffer.from("WEBP", "latin1"),
    chunk("VP8X", vp8x),
    chunk("VP8L", vp8l),
    chunk("EXIF", Buffer.from(exif, "latin1")),
  ]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
