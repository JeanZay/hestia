type ImageInfo = { width: number; height: number; orientation: number };

function orientationFromTiff(bytes: Uint8Array, base: number, end: number): number | null {
  if (base + 8 > end) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[base] === 73 && bytes[base + 1] === 73;
  if (!little && !(bytes[base] === 77 && bytes[base + 1] === 77)) return null;
  if (view.getUint16(base + 2, little) !== 42) return null;
  const offset = view.getUint32(base + 4, little), directory = base + offset;
  if (offset < 8 || directory + 2 > end) return null;
  const count = view.getUint16(directory, little);
  if (count > 256 || directory + 2 + count * 12 + 4 > end) return null;
  let orientation = 1, found = false;
  for (let i = 0; i < count; i++) {
    const entry = directory + 2 + i * 12;
    if (view.getUint16(entry, little) !== 274) continue;
    if (found || view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) return null;
    found = true; orientation = view.getUint16(entry + 8, little);
    if (orientation < 1 || orientation > 8) return null;
  }
  return orientation;
}

/** Camera-only preflight, not a replacement for full server validation. Unknown
 * structures keep their original bytes instead of being partially decoded. */
export function inspectCameraJpeg(bytes: Uint8Array): { width: number; height: number; orientation: number } | null {
  if (bytes.length < 4 || bytes.length > 20 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 2, width = 0, height = 0, orientation = 1, exifSeen = false, scanned = false, markers = 0;
  while (cursor < bytes.length && ++markers < 100_000) {
    if (bytes[cursor++] !== 255) return null;
    while (bytes[cursor] === 255) cursor++;
    const marker = bytes[cursor++];
    if (marker === 217) return scanned && width > 0 && cursor === bytes.length ? { width, height, orientation } : null;
    if (marker === 216 || marker === 0 || marker === 1 || (marker >= 208 && marker <= 215) || cursor + 2 > bytes.length) return null;
    const length = view.getUint16(cursor), end = cursor + length, payload = cursor + 2;
    if (length < 2 || end > bytes.length) return null;
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (![192, 194].includes(marker) || width || length < 8 || bytes[payload] !== 8) return null;
      height = view.getUint16(payload + 1); width = view.getUint16(payload + 3);
      const components = bytes[payload + 5];
      if (![1, 3].includes(components) || length !== 8 + 3 * components || !width || !height || width * height > 40_000_000) return null;
    }
    // MPO / gain-map containers must not silently become their first image.
    if (marker === 226 && bytes[payload] === 77 && bytes[payload + 1] === 80 && bytes[payload + 2] === 70) return null;
    if (marker === 225 && bytes[payload] === 69 && bytes[payload + 1] === 120 && bytes[payload + 2] === 105 && bytes[payload + 3] === 102) {
      if (exifSeen || length < 16 || bytes[payload + 4] || bytes[payload + 5]) return null;
      exifSeen = true;
      const parsed = orientationFromTiff(bytes, payload + 6, end);
      if (parsed === null) return null;
      orientation = parsed;
    }
    cursor = end;
    if (marker === 218) {
      if (!width || length < 6) return null;
      scanned = true;
      // Preserve scan structure, including progressive JPEG scans. A truncated
      // stream or trailing second image cannot be made valid by native decoding.
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 255) { cursor++; continue; }
        let next = cursor + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || (bytes[next] >= 208 && bytes[next] <= 215)) { cursor = next + 1; continue; }
        break;
      }
    }
  }
  return null;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function pngCrc(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function inspectPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8, chunks = 0, width = 0, height = 0, color = 0, orientation = 1, exif = false, palette = false, dataSeen = false, dataBytes = 0, dataEnded = false;
  while (cursor + 12 <= bytes.length && ++chunks < 100_000) {
    const length = view.getUint32(cursor), payload = cursor + 8, end = payload + length;
    if (end + 4 > bytes.length || pngCrc(bytes, cursor + 4, end) !== view.getUint32(end)) return null;
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, payload));
    if (!/^[A-Za-z]{4}$/.test(type) || (bytes[cursor + 6] & 32) || ["acTL", "fcTL", "fdAT"].includes(type)) return null;
    if (chunks === 1 && type !== "IHDR") return null;
    if (type === "IHDR") {
      if (chunks !== 1 || length !== 13) return null;
      width = view.getUint32(payload); height = view.getUint32(payload + 4); color = bytes[payload + 9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width * height > 40_000_000 || !depths[color]?.includes(bytes[payload + 8]) || bytes[payload + 10] || bytes[payload + 11] || bytes[payload + 12] > 1) return null;
    } else if (type === "PLTE") {
      if (palette || dataSeen || length < 3 || length > 768 || length % 3 || color === 0 || color === 4) return null;
      palette = true;
    } else if (type === "IDAT") {
      if (dataEnded || (color === 3 && !palette)) return null;
      dataSeen = true; dataBytes += length;
    } else if (type === "IEND") {
      return length === 0 && end + 4 === bytes.length && dataBytes > 0 ? { width, height, orientation } : null;
    } else if (type === "eXIf") {
      if (exif) return null; exif = true;
      const parsed = orientationFromTiff(bytes, payload, end);
      if (parsed === null) return null;
      orientation = parsed;
    } else if (!(bytes[cursor + 4] & 32)) return null; // Unknown critical chunk.
    if (type !== "IDAT" && dataSeen) dataEnded = true;
    cursor = end + 4;
  }
  return null;
}

function inspectWebp(bytes: Uint8Array): ImageInfo | null {
  const fourcc = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 20 || fourcc(0) !== "RIFF" || fourcc(8) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;
  let cursor = 12, chunks = 0, flags: number | undefined, canvasWidth = 0, canvasHeight = 0, width = 0, height = 0, orientation = 1, alpha = false, losslessAlpha = false, exif = false, icc = false, xmp = false;
  while (cursor + 8 <= bytes.length && ++chunks < 100_000) {
    const type = fourcc(cursor), length = view.getUint32(cursor + 4, true), payload = cursor + 8, end = payload + length;
    if (end + (length & 1) > bytes.length || ((length & 1) && bytes[end] !== 0) || ["ANIM", "ANMF"].includes(type)) return null;
    if (type === "VP8X") {
      if (chunks !== 1 || length !== 10) return null;
      flags = bytes[payload];
      if ((flags & 0xc3) || bytes[payload + 1] || bytes[payload + 2] || bytes[payload + 3]) return null;
      canvasWidth = 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16);
      canvasHeight = 1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16);
      if (canvasWidth * canvasHeight > 40_000_000) return null;
    } else if (type === "VP8 ") {
      if (width || length < 10 || (bytes[payload] & 1) || bytes[payload + 3] !== 157 || bytes[payload + 4] !== 1 || bytes[payload + 5] !== 42) return null;
      width = view.getUint16(payload + 6, true) & 0x3fff; height = view.getUint16(payload + 8, true) & 0x3fff;
      if (!width || !height) return null;
    } else if (type === "VP8L") {
      if (width || alpha || length < 5 || bytes[payload] !== 47) return null;
      const bits = view.getUint32(payload + 1, true);
      if (bits >>> 29) return null;
      width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; losslessAlpha = Boolean(bits & 0x10000000);
    } else if (type === "ALPH") {
      if (flags === undefined || alpha || width || !length) return null;
      alpha = true;
    } else if (type === "EXIF") {
      if (flags === undefined || exif) return null; exif = true;
      const prefix = length >= 6 && fourcc(payload) === "Exif" && bytes[payload + 4] === 0 && bytes[payload + 5] === 0;
      const parsed = orientationFromTiff(bytes, payload + (prefix ? 6 : 0), end);
      if (parsed === null) return null;
      orientation = parsed;
    } else if (type === "ICCP") {
      if (flags === undefined || icc || width || !length) return null; icc = true;
    } else if (type === "XMP ") {
      if (flags === undefined || xmp) return null; xmp = true;
    } else if (!width || flags === undefined) return null;
    if (width && (!height || width * height > 40_000_000)) return null;
    cursor = end + (length & 1);
  }
  if (cursor !== bytes.length || !width || !height) return null;
  if (flags !== undefined && (width !== canvasWidth || height !== canvasHeight || Boolean(flags & 16) !== (alpha || losslessAlpha) || Boolean(flags & 8) !== exif || Boolean(flags & 32) !== icc || Boolean(flags & 4) !== xmp)) return null;
  return { width, height, orientation };
}

export async function normalizeCameraImage(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  const type = file.type || (/\.jpe?g$/i.test(file.name) ? "image/jpeg" : /\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "");
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
  if (!file.size || file.size > 20 * 1024 * 1024 || typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = type === "image/jpeg" ? inspectCameraJpeg(bytes) : type === "image/png" ? inspectPng(bytes) : inspectWebp(bytes);
  if (!info) return null;
  // Chromium's native WebP decoder ignores EXIF mirrors (confirmed with an
  // asymmetric image). A size check cannot detect that. Keep every oriented
  // WebP byte-for-byte rather than silently flattening it in the wrong direction.
  if (type === "image/webp" && info.orientation !== 1) return null;
  let bitmap: ImageBitmap | undefined, canvas: OffscreenCanvas | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const swapped = info.orientation >= 5;
    if (bitmap.width !== (swapped ? info.height : info.width) || bitmap.height !== (swapped ? info.width : info.height)) return null;
    const ratio = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "white"; context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
    return blob.type === "image/jpeg" && blob.size > 0 && blob.size < file.size ? { blob, width, height } : null;
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

// This module is also imported by unit tests; never install a handler in the
// document or Node process. Next must bundle this same-origin module worker.
if (typeof document === "undefined" && typeof self !== "undefined" && typeof self.postMessage === "function") {
  self.onmessage = (event: MessageEvent<{ file: File }>) => {
    void normalizeCameraImage(event.data.file).then(result => self.postMessage(result)).catch(() => self.postMessage(null));
  };
}
