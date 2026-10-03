// Disposable Node process, stdin contains only a bounded synthetic/user original.
// Original bytes are never rewritten; decoded pixels and PDF operators are discarded.
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const declared = process.argv[2];
const started = performance.now();
function reject() { throw new Error("invalid file"); }
function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) reject();
}
async function main() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_BYTES) reject();
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  let mediaType;
  if (bytes.subarray(0, 5).toString() === "%PDF-") {
    mediaType = "application/pdf";
    if (declared !== mediaType || !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1"))) reject();
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // PDF.js >=5.7 removed its final eval path; no scripting/viewer sandbox is loaded here.
    const task = getDocument({ data: new Uint8Array(bytes), stopAtErrors: true,
      useSystemFonts: false, disableFontFace: true, useWasm: false, isImageDecoderSupported: false,
      maxImageSize: MAX_PIXELS, canvasMaxAreaInBytes: MAX_PIXELS * 4, verbosity: 0 });
    try {
      const doc = await task.promise;
      if (doc.numPages < 1 || doc.numPages > 1000) reject();
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const operators = await page.getOperatorList();
        if (operators.fnArray.length > 200_000) reject();
        page.cleanup();
      }
    } finally { await task.destroy(); }
  } else if (bytes.length > 12 && bytes.subarray(4, 8).toString() === "ftyp") {
    // Parse every top-level ISO BMFF box before libheif decoding, including truncated mdat.
    let cursor = 0;
    let brands = [];
    let boxes = 0;
    while (cursor < bytes.length) {
      if (++boxes > 10000 || cursor + 8 > bytes.length) reject();
      let length = bytes.readUInt32BE(cursor);
      let header = 8;
      if (length === 1) {
        if (cursor + 16 > bytes.length) reject();
        const large = bytes.readBigUInt64BE(cursor + 8);
        if (large > BigInt(MAX_BYTES)) reject();
        length = Number(large); header = 16;
      } else if (length === 0) length = bytes.length - cursor;
      if (length < header || cursor + length > bytes.length) reject();
      if (cursor === 0) {
        if (length < header + 8 || (length - header) % 4) reject();
        brands = [bytes.toString("ascii", cursor + header, cursor + header + 4)];
        for (let p = cursor + header + 8; p < cursor + length; p += 4) brands.push(bytes.toString("ascii", p, p + 4));
      }
      cursor += length;
    }
    if (!brands.some(brand => ["heic", "heix", "hevc", "hevx"].includes(brand)) || brands.includes("avif")) reject();
    mediaType = "image/heic";
    if (!["image/heic", "image/heif"].includes(declared)) reject();
    const { default: libheif } = await import("libheif-js");
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(bytes);
    if (!images.length || images.length > 16) reject();
    let totalPixels = 0;
    for (const image of images) {
      const width = image.get_width(), height = image.get_height();
      dimensions(width, height);
      totalPixels += width * height;
      if (totalPixels > MAX_PIXELS) reject();
      const data = new Uint8ClampedArray(width * height * 4);
      const decoded = await new Promise(resolve => image.display({ data, width, height }, resolve));
      if (!decoded) reject();
      image.free();
    }
  } else {
    const { default: sharp } = await import("sharp");
    sharp.cache(false);
    sharp.concurrency(1);
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_PIXELS, animated: true });
    const metadata = await image.metadata();
    mediaType = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[metadata.format];
    if (!mediaType || mediaType !== declared) reject();
    dimensions(metadata.width, metadata.height);
    // raw() forces the compressed image data to be consumed, not just its header.
    await image.raw().toBuffer();
  }
  const measurements = process.argv[3] === "--measure" ? {
    validationMs: Math.round(performance.now() - started), peakRssKiB: process.resourceUsage().maxRSS,
  } : {};
  process.stdout.write(JSON.stringify({ mediaType, previewSupported: !mediaType.startsWith("image/hei"), ...measurements }));
}
main().catch(error => { process.exitCode = error?.code === "ERR_MODULE_NOT_FOUND" ? 2 : 1; });
