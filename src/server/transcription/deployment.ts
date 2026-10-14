import type { ServerConfig } from "../config";
import type { TranscriptionDependencies } from "./types";
import { createOpenRouterTranscriptionProvider, parseQualifiedTranscriptionProfile } from "./openrouter";

/** Secret-free deployment evidence; user credentials remain encrypted in SQL.
 * Adding a qualified adapter is independent from the classification setting. */
export function readTranscriptionDeployment(environment: ServerConfig["environment"], env: Readonly<Record<string, string | undefined>> = process.env, now: () => Date = () => new Date()): Partial<Omit<TranscriptionDependencies, "capture">> {
  const disabled = { providers: [], allowRemote: false };
  const activation = environment === "production" ? "openrouter-stt-production" : "openrouter-stt-dev";
  if (!["dev", "production"].includes(environment) || env.HESTIA_TRANSCRIPTION_REMOTE !== activation) return disabled;
  const source = env.HESTIA_TRANSCRIPTION_PROFILES;
  if (!source || Buffer.byteLength(source) > 16_384) return disabled;
  try {
    const values: unknown = JSON.parse(source);
    if (!Array.isArray(values) || values.length < 1 || values.length > 8) return disabled;
    const profiles = values.map(value => parseQualifiedTranscriptionProfile(value, now()));
    if (profiles.some(value => value === null) || new Set(profiles.map(value => value!.model)).size !== profiles.length) return disabled;
    return { providers: [createOpenRouterTranscriptionProvider(profiles.filter(value => value !== null), fetch, now)], allowRemote: true };
  } catch { return disabled; }
}
