import { TRANSCRIPTION_MAX_AUDIO_BYTES, TRANSCRIPTION_MAX_DURATION_MS } from "../../shared/transcription-contract";
import { invalid } from "../access";
import type { AuthorizedFolder } from "../classification/types";

// Conservative local bound: ASCII 50 was accepted and 51 rejected in provider
// qualification. This does not assert a universal Unicode limit upstream.
export const TRANSCRIPTION_MAX_TERM_BYTES = 50;

/** Only the canonical PCM envelope emitted by our recorder is accepted. This
 * validates duration without trusting client clocks or decoding on the server. */
export function inspectDictationWav(bytes: Uint8Array): number {
  if (bytes.length < 46 || bytes.length > TRANSCRIPTION_MAX_AUDIO_BYTES) throw invalid();
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) => [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (!tag(0, "RIFF") || !tag(8, "WAVE") || !tag(12, "fmt ") || !tag(36, "data")
    || data.getUint32(4, true) !== bytes.length - 8 || data.getUint32(16, true) !== 16
    || data.getUint16(20, true) !== 1 || data.getUint16(22, true) !== 1
    || data.getUint32(24, true) !== 16_000 || data.getUint32(28, true) !== 32_000
    || data.getUint16(32, true) !== 2 || data.getUint16(34, true) !== 16
    || data.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2) throw invalid();
  const durationMs = (bytes.length - 44) / 32;
  if (durationMs <= 0 || durationMs > TRANSCRIPTION_MAX_DURATION_MS) throw invalid();
  return durationMs;
}

/** Inputs are already consultable AND depositable. Never use ancestor paths. */
export function dictationVocabulary(folders: readonly AuthorizedFolder[]): string[] {
  const seen = new Set<string>(), phrases: string[] = []; let size = 0;
  for (const folder of folders) {
    const name = folder.name.normalize("NFC").trim();
    const bytes = Buffer.byteLength(name);
    if (!name || bytes > TRANSCRIPTION_MAX_TERM_BYTES || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name)) continue;
    const key = name.toLocaleLowerCase("fr"); if (seen.has(key)) continue;
    seen.add(key);
    if (size + bytes > 2048) continue;
    phrases.push(name); size += bytes;
    if (phrases.length === 64) break;
  }
  return phrases;
}

export function transcriptText(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > 65_536 || [...value].length > 16_384
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw invalid();
  // Over 2,000 characters is intentionally allowed: the user edits it separately.
  return value.trim();
}
