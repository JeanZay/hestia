/* Bounded mono resampling in the audio thread. No audio storage or networking. */
class HestiaDictation extends AudioWorkletProcessor {
  constructor() {
    super(); this.ratio = sampleRate / 16000; this.weight = 0; this.sum = 0;
    this.buffer = new Int16Array(4096); this.length = 0; this.count = 0; this.finished = false;
    this.port.onmessage = event => { if (event.data === "flush") { this.finished = true; this.flush(); this.port.postMessage("flushed"); } };
  }
  flush() { if (this.length) { const chunk = this.buffer.slice(0, this.length); this.port.postMessage(chunk, [chunk.buffer]); this.length = 0; } }
  process(inputs) {
    if (this.finished) return true;
    const channels = inputs[0]; if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length && this.count < 1920000; i++) {
      let value = 0; for (const channel of channels) value += channel[i] / channels.length;
      let remaining = 1;
      while (remaining > 1e-8 && this.count < 1920000) {
        const part = Math.min(remaining, this.ratio - this.weight); this.sum += value * part; this.weight += part; remaining -= part;
        if (this.weight >= this.ratio - 1e-8) {
          const sample = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.buffer[this.length++] = Math.round(sample * (sample < 0 ? 32768 : 32767)); this.count++;
          this.sum = 0; this.weight = 0; if (this.length === this.buffer.length) this.flush();
        }
      }
    }
    if (this.count >= 1920000) { this.finished = true; this.flush(); }
    return true;
  }
}
registerProcessor("hestia-dictation", HestiaDictation);
