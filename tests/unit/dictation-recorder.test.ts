import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { DictationRecorder, DICTATION_MAX_SAMPLES, encodeDictationWav } from "../../src/components/hestia/dictation-recorder";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("dictation audio custody and wire format", () => {
  it("encodes a portable 44-byte PCM16 mono 16 kHz WAV without changing source samples", async () => {
    const samples = new Int16Array([-32768, -123, 0, 123, 32767]);
    const blob = encodeDictationWav([samples.subarray(0, 2), samples.subarray(2)]), bytes = await blob.arrayBuffer(), data = new DataView(bytes);
    expect(blob.type).toBe("audio/wav"); expect(blob.size).toBe(54);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(data.getUint32(4, true)).toBe(46); expect(data.getUint32(16, true)).toBe(16);
    expect(data.getUint16(20, true)).toBe(1); expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint32(24, true)).toBe(16000); expect(data.getUint16(34, true)).toBe(16); expect(data.getUint32(40, true)).toBe(10);
    expect(Array.from({ length: 5 }, (_, i) => data.getInt16(44 + i * 2, true))).toEqual([...samples]);
  });
  it("bounds the upload below Vercel's 4.5MB limit and refuses empty or overlong recordings", () => {
    expect(encodeDictationWav([new Int16Array(DICTATION_MAX_SAMPLES)]).size).toBe(3_840_044);
    expect(() => encodeDictationWav([])).toThrow(); expect(() => encodeDictationWav([new Int16Array(DICTATION_MAX_SAMPLES + 1)])).toThrow();
  });
  it("stops a microphone that becomes available after cancellation and never builds a node", async () => {
    let resolve!: (value: unknown) => void;
    const mic = new Promise(resolveValue => { resolve = resolveValue; }), stop = vi.fn(), close = vi.fn(async () => {}), addModule = vi.fn();
    vi.stubGlobal("AudioContext", class { resume = async () => {}; close = close; audioWorklet = { addModule }; });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => mic } });
    const recorder = new DictationRecorder(), controller = new AbortController(), result = recorder.start(controller.signal, vi.fn());
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); controller.abort(); resolve({ getTracks: () => [{ stop }] }); await rejected;
    expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(addModule).not.toHaveBeenCalled();
  });
});

describe("audio worklet streaming resampling", () => {
  const source = readFileSync("public/hestia/dictation-worklet.js", "utf8");
  function create(rate: number) {
    const chunks: Int16Array[] = [];
    type Processor = { port: { onmessage: (event: { data: string }) => void }; process: (input: Float32Array[][]) => boolean };
    let Constructor!: new () => Processor;
    runInNewContext(source, { sampleRate: rate, Int16Array, AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (chunk: unknown) => { if (chunk instanceof Int16Array) chunks.push(chunk); } }; }, registerProcessor: (_: string, value: new () => Processor) => { Constructor = value; } });
    return { processor: new Constructor(), chunks };
  }
  it.each([44100, 48000])("keeps duration and averages stereo safely at %iHz across render quanta", rate => {
    const { processor, chunks } = create(rate);
    for (let sent = 0; sent < rate; sent += 128) { const n = Math.min(128, rate - sent); processor.process([[new Float32Array(n).fill(0.75), new Float32Array(n).fill(0.25)]]); }
    processor.port.onmessage({ data: "flush" });
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(16000);
    // Non-integral 44.1kHz ratios may quantize either side of the half LSB.
    for (const chunk of chunks) for (const sample of new Set(chunk)) expect(Math.abs(sample - 16384)).toBeLessThanOrEqual(1);
  });
  it("stops at exactly two minutes with no unbounded buffers or extra samples", () => {
    const { processor, chunks } = create(16000), input = [[new Float32Array(128)]];
    for (let n = 0; n < 15010; n++) processor.process(input);
    processor.port.onmessage({ data: "flush" });
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(DICTATION_MAX_SAMPLES);
    expect(chunks.every(chunk => chunk.length <= 4096)).toBe(true);
  });
});
