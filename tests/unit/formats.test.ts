import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { validateOriginal, MAX_ORIGINAL_BYTES } from "../../src/server/formats";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/documents/${name}`, import.meta.url));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("bounded original format validation", () => {
  it.each([
    ["synthetic.pdf", "application/pdf", true], ["synthetic.png", "image/png", true],
    ["synthetic.jpg", "image/jpeg", true], ["synthetic.webp", "image/webp", true],
    ["synthetic.heic", "image/heic", false], ["synthetic.heic", "image/heif", false],
  ])("decodes %s declared %s without rewriting the original", async (name, mediaType, previewSupported) => {
    const original = fixture(name as string);
    const before = digest(original);
    expect(await validateOriginal(original, mediaType as string)).toEqual({
      mediaType: mediaType === "image/heif" ? "image/heic" : mediaType, previewSupported,
    });
    expect(digest(original)).toBe(before);
  });

  it.each([
    ["synthetic.png", "image/jpeg"], ["synthetic.pdf", "image/png"],
    ["synthetic.heic", "image/png"], ["corrupt.pdf", "application/pdf"], ["corrupt.png", "image/png"],
  ])("rejects forged or corrupt %s as %s", async (name, type) => {
    await expect(validateOriginal(fixture(name), type)).rejects.toMatchObject({ code: "invalid_file" });
  });

  it.each([["synthetic.jpg", "image/jpeg"], ["synthetic.webp", "image/webp"],
    ["synthetic.png", "image/png"], ["synthetic.heic", "image/heic"]])("rejects truncated compressed body %s", async (name, type) => {
    const original = fixture(name);
    await expect(validateOriginal(original.subarray(0, Math.floor(original.length * 0.7)), type))
      .rejects.toMatchObject({ code: "invalid_file" });
  });

  it("rejects non-image formats even with a declared image type", async () => {
    for (const body of ["<svg xmlns='http://www.w3.org/2000/svg'/>", "<html>hello</html>", "MZprogram"]) {
      await expect(validateOriginal(Buffer.from(body), "image/png")).rejects.toMatchObject({ code: "invalid_file" });
    }
    await expect(validateOriginal(fixture("synthetic.png"), "image/svg+xml")).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("rejects pixel bombs before raster decoding", async () => {
    const giant = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(validateOriginal(giant, "image/png")).rejects.toMatchObject({ code: "invalid_file" });
  });

  it("accepts a real PDF at exactly 20 MiB and refuses one extra byte", async () => {
    const small = fixture("synthetic.pdf");
    const eof = Buffer.from("%%EOF\n");
    const prefix = small.subarray(0, small.length - eof.length);
    const original = Buffer.concat([prefix, Buffer.alloc(MAX_ORIGINAL_BYTES - prefix.length - eof.length, 32), eof]);
    expect(original.byteLength).toBe(MAX_ORIGINAL_BYTES);
    expect(await validateOriginal(original, "application/pdf")).toEqual({ mediaType: "application/pdf", previewSupported: true });
    await expect(validateOriginal(Buffer.concat([original, Buffer.from(" ")]), "application/pdf"))
      .rejects.toMatchObject({ code: "file_too_large" });
  });

  it("refuses an empty upload", async () => {
    await expect(validateOriginal(new Uint8Array(), "image/png")).rejects.toMatchObject({ code: "invalid_file" });
  });
});
