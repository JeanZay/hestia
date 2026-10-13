import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createCameraNormalizer } from "../../src/components/hestia/camera-normalize";
import { inspectCameraJpeg, normalizeCameraImage } from "../../src/components/hestia/camera-normalize-worker";

type Port = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
function port() {
  return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null } as Port;
}
function respond(worker: Port, data: unknown) { worker.onmessage?.call(worker as Worker, { data } as MessageEvent); }
const photo = () => new File([new Uint8Array(100)], "source.jpeg", { type: "image/jpeg", lastModified: 123 });
const optimized = () => ({ blob: new Blob([new Uint8Array(30)], { type: "image/jpeg" }), width: 3200, height: 1600 });
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("camera normalization ownership and fallback", () => {
  it("deduplicates one selection and serializes two, without unbounded retained files", async () => {
    const workers: Port[] = [], factory = vi.fn(() => { const worker = port(); workers.push(worker); return worker; });
    const normalizer = createCameraNormalizer(factory), file = photo(), identity = {};
    const first = normalizer.normalize(file, signal(), identity);
    expect(normalizer.normalize(file, signal(), identity)).toBe(first);
    const second = normalizer.normalize(file, signal(), {});
    await expect(normalizer.normalize(file, signal(), {})).resolves.toBe(file);
    expect(factory).toHaveBeenCalledTimes(1);
    respond(workers[0], optimized()); const selected = await first;
    expect(selected).not.toBe(file); expect(selected.name).toBe("source.jpg"); expect(selected.type).toBe("image/jpeg"); expect(selected.lastModified).toBe(123);
    expect(factory).toHaveBeenCalledTimes(2); expect(workers[0].terminate).toHaveBeenCalledOnce();
    respond(workers[1], null); await expect(second).resolves.toBe(file);
  });
  it("aborts the active and queued generation; late worker results cannot succeed", async () => {
    const worker = port(), factory = vi.fn(() => worker), normalizer = createCameraNormalizer(factory);
    const first = normalizer.normalize(photo(), signal(), {}), second = normalizer.normalize(photo(), signal(), {});
    const checks = [expect(first).rejects.toMatchObject({ name: "AbortError" }), expect(second).rejects.toMatchObject({ name: "AbortError" })];
    normalizer.clear(); respond(worker, optimized()); await Promise.all(checks);
    expect(factory).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("an aborted caller never falls back into a late upload", async () => {
    const controller = new AbortController(), worker = port(), normalizer = createCameraNormalizer(() => worker);
    const result = normalizer.normalize(photo(), controller.signal, {}), rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); respond(worker, optimized()); await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("falls back unchanged when a worker cannot load, times out or returns larger/invalid output", async () => {
    const file = photo();
    await expect(createCameraNormalizer(() => { throw new Error("worker blocked"); }).normalize(file, signal(), {})).resolves.toBe(file);
    for (const data of [{ ...optimized(), blob: new Blob([new Uint8Array(101)], { type: "image/jpeg" }) }, { ...optimized(), width: 3201 }, { ...optimized(), blob: new Blob([], { type: "image/jpeg" }) }]) {
      const worker = port(), result = createCameraNormalizer(() => worker).normalize(file, signal(), {}); respond(worker, data); await expect(result).resolves.toBe(file);
    }
    vi.useFakeTimers(); const worker = port(), result = createCameraNormalizer(() => worker, 25).normalize(file, signal(), {});
    await vi.advanceTimersByTimeAsync(25); await expect(result).resolves.toBe(file); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("does not start a decoder for unsupported formats or source byte limits", async () => {
    const factory = vi.fn(() => port()), normalizer = createCameraNormalizer(factory);
    for (const file of [new File([new Uint8Array(2)], "scan.heic", { type: "image/heic" }), new File([], "empty.jpg", { type: "image/jpeg" }), new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" })]) await expect(normalizer.normalize(file, signal(), {})).resolves.toBe(file);
    expect(factory).not.toHaveBeenCalled();
  });
  it.each(["png", "webp"])("hands camera %s selections to the same serialized worker and preserves raw fallback identity", async extension => {
    const worker = port(), normalizer = createCameraNormalizer(() => worker);
    for (const type of [`image/${extension}`, ""]) {
      const file = new File([new Uint8Array(100)], `camera.${extension}`, { type, lastModified: 456 });
      const unchanged = normalizer.normalize(file, signal(), {}); respond(worker, null);
      await expect(unchanged).resolves.toBe(file);
      const changed = normalizer.normalize(file, signal(), {}); respond(worker, optimized());
      const result = await changed;
      expect(result.name).toBe("camera.jpg"); expect(result.type).toBe("image/jpeg"); expect(result.lastModified).toBe(456);
    }
  });
});

describe("camera JPEG preflight before native decoding", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("reads EXIF orientation %i without rewriting bytes", async orientation => {
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation }).toBuffer();
    expect(inspectCameraJpeg(bytes)).toEqual({ width: 120, height: 80, orientation });
  });
  it("keeps truncated, concatenated, multi-picture and over-budget JPEGs on their original path", async () => {
    const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "red" } }).jpeg({ progressive: true }).toBuffer();
    expect(inspectCameraJpeg(bytes)).toMatchObject({ width: 100, height: 80 });
    expect(inspectCameraJpeg(bytes.subarray(0, bytes.length - 3))).toBeNull();
    expect(inspectCameraJpeg(Buffer.concat([bytes, bytes]))).toBeNull();
    const mpo = Buffer.concat([bytes.subarray(0, 2), Buffer.from([255, 226, 0, 6, 77, 80, 70, 0]), bytes.subarray(2)]);
    expect(inspectCameraJpeg(mpo)).toBeNull();
    const tooMany = Buffer.from(bytes); const sof = tooMany.indexOf(Buffer.from([255, 194]));
    tooMany.writeUInt16BE(8000, sof + 5); tooMany.writeUInt16BE(6000, sof + 7);
    expect(inspectCameraJpeg(tooMany)).toBeNull();
  });
  it("uses oriented dimensions, reduces without enlargement and releases native resources", async () => {
    const source = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const bitmap = { width: 2000, height: 4000, close: vi.fn() };
    const decode = vi.fn().mockResolvedValue(bitmap), draw = vi.fn(), encode = vi.fn().mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    const canvases: { width: number; height: number }[] = [];
    class Canvas { constructor(public width: number, public height: number) { canvases.push(this); } getContext() { return { fillStyle: "", fillRect: vi.fn(), drawImage: draw }; } convertToBlob = encode; }
    vi.stubGlobal("createImageBitmap", decode); vi.stubGlobal("OffscreenCanvas", Canvas);
    const file = new File([new Uint8Array(source)], "camera.jpg", { type: "image/jpeg" });
    await expect(normalizeCameraImage(file)).resolves.toMatchObject({ width: 1600, height: 3200 });
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 3200);
    expect(encode).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.88 });
    expect(bitmap.close).toHaveBeenCalledOnce(); expect(canvases[0]).toEqual({ width: 0, height: 0, convertToBlob: encode });
    bitmap.width = 120; bitmap.height = 80;
    const small = await sharp({ create: { width: 120, height: 80, channels: 3, background: "red" } }).jpeg().toBuffer();
    await expect(normalizeCameraImage(new File([new Uint8Array(small)], "small.jpg", { type: "image/jpeg" }))).resolves.toMatchObject({ width: 120, height: 80 });
    expect(draw).toHaveBeenLastCalledWith(bitmap, 0, 0, 120, 80);
  });
  it("does not send unqualified files to a tolerant native decoder", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode); vi.stubGlobal("OffscreenCanvas", class {});
    expect(await normalizeCameraImage(new File([new Uint8Array([255, 216, 255, 217])], "broken.jpg", { type: "image/jpeg" }))).toBeNull();
    expect(await normalizeCameraImage(new File([new Uint8Array(10)], "scan.heic", { type: "image/heic" }))).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
  it("keeps JPEG with an auxiliary gain-map or second image on the raw path, without claiming Ultra HDR support",async()=>{
    const base=await sharp({create:{width:100,height:80,channels:3,background:"white"}}).jpeg().toBuffer();
    const auxiliary=await sharp({create:{width:25,height:20,channels:3,background:"gray"}}).jpeg().toBuffer();
    // Synthetic container markers only; this is a conservative fallback check,
    // not a qualification of JPEG_R decoding or a physical Pixel camera.
    const mpf=Buffer.concat([base.subarray(0,2),Buffer.from([255,226,0,6,77,80,70,0]),base.subarray(2),auxiliary]);
    const decode=vi.fn();vi.stubGlobal("createImageBitmap",decode);vi.stubGlobal("OffscreenCanvas",class {});
    for(const bytes of [mpf,Buffer.concat([base,auxiliary])]){
      const file=new File([new Uint8Array(bytes)],"camera.jpg",{type:"image/jpeg"});
      expect(await normalizeCameraImage(file)).toBeNull();
    }
    expect(decode).not.toHaveBeenCalled();
  });
  it("releases bitmap/canvas when encoding fails and refuses an un-applied orientation",async()=>{
    const bytes=await sharp({create:{width:120,height:80,channels:3,background:"blue"}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const file=new File([new Uint8Array(bytes)],"oriented.jpg",{type:"image/jpeg"}),bitmap={width:120,height:80,close:vi.fn()},canvases:{width:number;height:number}[]=[];
    vi.stubGlobal("createImageBitmap",vi.fn().mockResolvedValue(bitmap));
    class Canvas { constructor(public width:number,public height:number){canvases.push(this);}getContext(){return{fillStyle:"",fillRect:vi.fn(),drawImage:vi.fn()};}async convertToBlob(){throw new Error("encoder failed");} }
    vi.stubGlobal("OffscreenCanvas",Canvas);
    await expect(normalizeCameraImage(file)).resolves.toBeNull();expect(bitmap.close).toHaveBeenCalledOnce();expect(canvases).toHaveLength(0);
    bitmap.width=80;bitmap.height=120;await expect(normalizeCameraImage(file)).rejects.toThrow("encoder failed");expect(bitmap.close).toHaveBeenCalledTimes(2);expect(canvases[0].width).toBe(0);expect(canvases[0].height).toBe(0);
  });
});

function nativeImage(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() }, decode = vi.fn().mockResolvedValue(bitmap);
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const encode = vi.fn().mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
  class Canvas { constructor(public width: number, public height: number) {} getContext() { return context; } convertToBlob = encode; }
  vi.stubGlobal("createImageBitmap", decode); vi.stubGlobal("OffscreenCanvas", Canvas);
  return { bitmap, decode, context, encode };
}
function imageFile(bytes: Uint8Array, format: "png" | "webp") { return new File([new Uint8Array(bytes)], `camera.${format}`, { type: `image/${format}` }); }
// Small container mutations exercise preflight refusals before the tolerant
// browser decoder. The underlying PNG/WebP payloads are real Sharp encodings.
function pngChunk(type: string, payload = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(payload.length + 12); chunk.writeUInt32BE(payload.length); chunk.write(type, 4); payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4); return chunk;
}
function webpChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(8 + payload.length + (payload.length & 1)); chunk.write(type); chunk.writeUInt32LE(payload.length, 4); payload.copy(chunk, 8); return chunk;
}
function webpContainer(...chunks: Buffer[]) {
  const bytes = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "binary"), ...chunks]); bytes.writeUInt32LE(bytes.length - 8, 4); return bytes;
}
function webpChunks(bytes: Buffer) {
  const chunks: Buffer[] = []; for (let offset = 12; offset < bytes.length;) { const end = offset + 8 + bytes.readUInt32LE(offset + 4); chunks.push(bytes.subarray(offset, end + ((end - offset) & 1))); offset = end + ((end - offset) & 1); } return chunks;
}

describe("camera PNG and static WebP preflight", () => {
  it.each(["png", "webp"] as const)("normalizes real %s encodings, including lossless, alpha, metadata and oriented dimensions", async format => {
    for (const orientation of format === "png" ? [1, 2, 3, 4, 5, 6, 7, 8] : [1]) {
      const input = sharp({ create: { width: 120, height: 80, channels: 4, background: { r: 23, g: 54, b: 89, alpha: 0.5 } } }).withMetadata({ orientation });
      const bytes = await (format === "png" ? input.png({ progressive: true }) : input.webp({ lossless: orientation % 2 === 0 })).toBuffer();
      const width = orientation >= 5 ? 80 : 120, height = orientation >= 5 ? 120 : 80;
      const native = nativeImage(width, height), file = imageFile(bytes, format);
      await expect(normalizeCameraImage(file)).resolves.toMatchObject({ width, height });
      expect(native.decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
      expect(native.context.fillStyle).toBe("white"); expect(native.context.fillRect).toHaveBeenCalledWith(0, 0, width, height);
      expect(native.context.drawImage).toHaveBeenCalledWith(native.bitmap, 0, 0, width, height);
      expect(native.encode).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.88 }); expect(native.bitmap.close).toHaveBeenCalledOnce();
    }
  });
  it("rejects an unapplied PNG orientation and larger output", async () => {
    const format = "png";
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: "red" } }).png().withMetadata({ orientation: 6 }).toBuffer();
    const native = nativeImage(120, 80), file = imageFile(bytes, format);
    await expect(normalizeCameraImage(file)).resolves.toBeNull(); expect(native.encode).not.toHaveBeenCalled();
    native.bitmap.width = 80; native.bitmap.height = 120;
    native.encode.mockResolvedValue(new Blob([new Uint8Array(file.size + 1)], { type: "image/jpeg" }));
    await expect(normalizeCameraImage(file)).resolves.toBeNull(); expect(native.bitmap.close).toHaveBeenCalledTimes(2);
  });
  it("keeps oriented WebP bytes unchanged even if native decoding would ignore mirrors", async () => {
    const native = nativeImage(120, 80);
    for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
      const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: "red" } }).webp().withMetadata({ orientation }).toBuffer();
      const file = imageFile(bytes, "webp"), worker = port(), result = createCameraNormalizer(() => worker).normalize(file, signal(), {});
      const output = await normalizeCameraImage(file); expect(output).toBeNull(); respond(worker, output);
      await expect(result).resolves.toBe(file);
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(bytes));
    }
    expect(native.decode).not.toHaveBeenCalled();
  });
  it("rejects PNG CRC failures, truncation, multiple images, animation and dimensions before decoding", async () => {
    const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "red" } }).png().toBuffer();
    const native = nativeImage(100, 80), badCrc = Buffer.from(bytes); badCrc[29] ^= 1;
    const huge = Buffer.from(bytes.subarray(16, 29)); huge.writeUInt32BE(8000, 0); huge.writeUInt32BE(6000, 4);
    const badSources = [badCrc, bytes.subarray(0, -1), Buffer.concat([bytes, bytes]), Buffer.concat([bytes.subarray(0, 8), pngChunk("IHDR", huge), bytes.subarray(33)])];
    for (const animation of ["acTL", "fcTL", "fdAT"]) badSources.push(Buffer.concat([bytes.subarray(0, 33), pngChunk(animation, Buffer.alloc(8)), bytes.subarray(33)]));
    // Even an empty IDAT starts the data sequence; ancillary data cannot split it.
    badSources.push(Buffer.concat([bytes.subarray(0, 33), pngChunk("IDAT"), pngChunk("tEXt", Buffer.from("x\0y")), bytes.subarray(33)]));
    for (const input of badSources) await expect(normalizeCameraImage(imageFile(input, "png"))).resolves.toBeNull();
    await expect(normalizeCameraImage(imageFile(bytes, "webp"))).resolves.toBeNull(); expect(native.decode).not.toHaveBeenCalled();
  });
  it("rejects WebP truncation, duplicate frames, animation, inconsistent canvas and dimensions before decoding", async () => {
    const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "blue" } }).webp().toBuffer();
    const chunks = webpChunks(bytes), native = nativeImage(100, 80);
    const extended = Buffer.alloc(10); extended[4] = 99; extended[7] = 79;
    const animated = Buffer.from(extended); animated[0] = 2;
    const inconsistent = Buffer.from(extended); inconsistent[4] = 100;
    const huge = Buffer.from(extended); huge.writeUIntLE(7999, 4, 3); huge.writeUIntLE(5999, 7, 3);
    const badSources = [bytes.subarray(0, -1), Buffer.concat([bytes, bytes]), webpContainer(...chunks, ...chunks), webpContainer(webpChunk("VP8X", animated), ...chunks), webpContainer(webpChunk("VP8X", inconsistent), ...chunks), webpContainer(webpChunk("VP8X", huge), ...chunks)];
    for (const animation of ["ANIM", "ANMF"]) badSources.push(webpContainer(webpChunk("VP8X", extended), ...chunks, webpChunk(animation, Buffer.alloc(8))));
    const zeroFrame = Buffer.from(chunks[0]); zeroFrame.writeUInt16LE(0, 14); badSources.push(webpContainer(zeroFrame, ...chunks));
    for (const input of badSources) await expect(normalizeCameraImage(imageFile(input, "webp"))).resolves.toBeNull();
    await expect(normalizeCameraImage(imageFile(bytes, "png"))).resolves.toBeNull(); expect(native.decode).not.toHaveBeenCalled();
  });
  it.each(["png", "webp"] as const)("bounds native %s decoding to 40 MP and reduces the long edge without enlargement", async format => {
    const bytes = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: "blue" } }).toFormat(format).toBuffer();
    const native = nativeImage(4000, 2000);
    await expect(normalizeCameraImage(imageFile(bytes, format))).resolves.toMatchObject({ width: 3200, height: 1600 });
    expect(native.context.drawImage).toHaveBeenCalledWith(native.bitmap, 0, 0, 3200, 1600);
  });
});
