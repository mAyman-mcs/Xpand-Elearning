import { describe, expect, it } from "vitest";
import { jpeg, png, webp } from "../../test/images.js";
import { sanitizeImage, UPLOAD_MAX_BYTES } from "./image.js";

const clean = (b: Buffer) => {
  const r = sanitizeImage(b);
  if ("problem" in r) throw new Error(r.problem);
  return r;
};
const problem = (b: Buffer) => {
  const r = sanitizeImage(b);
  return "problem" in r ? r.problem : null;
};

describe("sanitizeImage", () => {
  it("reads a PNG's size and drops text chunks and trailing bytes", () => {
    const r = clean(png(5, 3, { text: "secret author", trailer: "<script>alert(1)</script>" }));
    expect(r).toMatchObject({ mime: "image/png", width: 5, height: 3 });
    expect(r.data.toString("latin1")).not.toContain("secret author");
    expect(r.data.toString("latin1")).not.toContain("<script>");
    expect(r.data.toString("latin1").endsWith("IEND\xaeB`\x82")).toBe(true);
  });

  it("keeps a clean PNG byte for byte", () => {
    const original = png(2, 2);
    expect(clean(original).data.equals(original)).toBe(true);
  });

  it("reads a JPEG's size and drops EXIF and comments", () => {
    const r = clean(Buffer.concat([jpeg(640, 480, "GPS 52.1,4.3"), Buffer.from("trailing")]));
    expect(r).toMatchObject({ mime: "image/jpeg", width: 640, height: 480 });
    const text = r.data.toString("latin1");
    expect(text).toContain("JFIF");
    expect(text).not.toContain("GPS");
    expect(text).not.toContain("camera");
    expect(text).not.toContain("trailing");
    expect(r.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it("reads a WebP's size, drops EXIF and clears the EXIF flag", () => {
    const r = clean(webp(300, 200, "GPS 52.1,4.3"));
    expect(r).toMatchObject({ mime: "image/webp", width: 300, height: 200 });
    expect(r.data.toString("latin1")).not.toContain("GPS");
    expect(r.data.readUInt32LE(4)).toBe(r.data.length - 8);
    const vp8x = r.data.indexOf("VP8X", 0, "latin1");
    expect((r.data[vp8x + 8] as number) & 0x08).toBe(0);
  });

  it("refuses files that only claim to be pictures", () => {
    expect(problem(Buffer.from("<html><script>alert(1)</script></html>"))).toMatch(/PNG, JPEG or WebP/);
    expect(problem(Buffer.from("GIF89a......"))).toMatch(/PNG, JPEG or WebP/);
    expect(problem(Buffer.alloc(0))).toMatch(/empty/);
  });

  it("refuses damaged pictures", () => {
    expect(problem(png(4, 4).subarray(0, 40))).toMatch(/damaged/);
    expect(problem(jpeg().subarray(0, 30))).toMatch(/damaged/);
    expect(problem(webp().subarray(0, 24))).toMatch(/damaged/);
  });

  it("refuses pictures that are too large", () => {
    expect(problem(png(9000, 1))).toMatch(/too large/);
    expect(problem(Buffer.alloc(UPLOAD_MAX_BYTES + 1))).toMatch(/2 MB/);
  });
});
