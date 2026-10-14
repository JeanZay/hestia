/** Small, lazily loaded PCM recorder. Audio lives only in bounded memory. */
export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_MAX_SAMPLES = DICTATION_SAMPLE_RATE * 120;
export function encodeDictationWav(chunks: Int16Array[]): Blob {
  const count = chunks.reduce((n, chunk) => n + chunk.length, 0);
  if (!count || count > DICTATION_MAX_SAMPLES) throw new Error("Enregistrement vide ou trop long.");
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const label = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  label(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); label(8, "WAVE"); label(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, DICTATION_SAMPLE_RATE, true); view.setUint32(28, DICTATION_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, sample, true); offset += 2; }
  return new Blob([bytes], { type: "audio/wav" });
}
export function supportsDictation() {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
    && typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined";
}
export class DictationRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Int16Array[] = [];
  private count = 0;
  private disposed = false;
  private flushed: (() => void) | null = null;
  private unregister: (() => void) | null = null;
  async start(signal: AbortSignal, onLimit: () => void) {
    signal.throwIfAborted();
    const abort = () => this.cancel();
    signal.addEventListener("abort", abort, { once: true });
    this.unregister = () => signal.removeEventListener("abort", abort);
    try {
      this.context = new AudioContext();
      await this.context.resume();
      signal.throwIfAborted();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (this.disposed || signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new DOMException("Annulé", "AbortError"); }
      this.stream = stream;
      await this.context.audioWorklet.addModule("/hestia/dictation-worklet.js");
      signal.throwIfAborted();
      const node = new AudioWorkletNode(this.context, "hestia-dictation"); this.node = node;
      node.port.onmessage = event => {
        if (this.disposed) return;
        if (event.data === "flushed") { this.flushed?.(); return; }
        const chunk = event.data;
        if (!(chunk instanceof Int16Array)) return;
        const kept = chunk.slice(0, DICTATION_MAX_SAMPLES - this.count);
        if (kept.length) { this.chunks.push(kept); this.count += kept.length; }
        if (this.count >= DICTATION_MAX_SAMPLES) onLimit();
      };
      this.context.createMediaStreamSource(stream).connect(node);
      // The processor emits silence, never microphone audio, to keep processing active.
      node.connect(this.context.destination);
    } catch (error) { this.cancel(); throw error; }
  }
  async stop(): Promise<Blob> {
    if (this.disposed || !this.node) throw new DOMException("Annulé", "AbortError");
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("L’enregistrement n’a pas pu être terminé.")), 1000);
        this.flushed = () => { clearTimeout(timer); resolve(); };
        this.node!.port.postMessage("flush");
      });
      if (this.disposed) throw new DOMException("Annulé", "AbortError");
      return encodeDictationWav(this.chunks);
    }
    finally { this.cancel(); }
  }
  cancel() {
    this.unregister?.(); this.unregister = null;
    this.disposed = true; this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.node?.disconnect(); this.node?.port.close(); this.node = null;
    void this.context?.close().catch(() => {}); this.context = null;
    this.chunks.forEach(chunk => chunk.fill(0)); this.chunks = []; this.count = 0;
    this.flushed?.(); this.flushed = null;
  }
}
