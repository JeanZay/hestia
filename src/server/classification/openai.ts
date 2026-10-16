import { createHash } from "node:crypto";
import { CAPTURE_PATH_MAX_LEVELS } from "../../shared/capture-path";
import { CLASSIFICATION_REFERENCE, CLASSIFICATION_RELEVANCE_SCHEMA, classificationContext, classificationInstructions, normalizeClassificationSuggestions } from "./reference-tree";
import type { CaptureMediaType } from "../../shared/capture-contract";
import type { ClassificationConfiguration, ClassificationProvider, ProviderPayload } from "./types";
import { micros } from "./validation";

/** Explicit deployment evidence supplies bounds in EUR. No default model,
 * exchange rate, token price or approval is inferred from a model name. */
export type QualifiedOpenAIProfile = Readonly<{
  model: string; classificationContractSha256: string; qualificationRef: string; currency: "EUR"; maximumMicros: number;
  maxInputBytes: number; maxFolderBytes: number; maxOutputTokens: number;
  mediaTypes: readonly CaptureMediaType[];
  // Exact EUR reconciliation is deployment-specific. null keeps the debt.
  actualCost: (usage: unknown) => number | null;
}>;
const schema = {
  type: "object", additionalProperties: false, required: ["existing", "created", "contradiction"], properties: {
    existing: { type: "array", description: "Alternatives de classement dans des dossiers existants autorisés, étayées par le document OU preparationComment, y compris l’usage demandé ; chaque source peut suffire sans prouver leur lien. reason attribue cet appui à sa source. Liste vide si aucune destination existante n’est positivement étayée.", items: { type: "object", additionalProperties: false, required: ["folderId", "reason", "relevance"], properties: { folderId: { type: "string" }, reason: { type: "string" }, relevance: CLASSIFICATION_RELEVANCE_SCHEMA } } },
    created: { type: "array", description: "Alternatives de chemins utiles absents du catalogue, indépendantes des destinations existantes, étayées par le document OU preparationComment, y compris l’usage demandé ; chaque source peut suffire sans prouver leur lien. reason attribue cet appui à sa source. Propositions futures, jamais créations effectuées. Liste vide si aucun chemin utile n’est positivement étayé.", items: { type: "object", additionalProperties: false, required: ["parentId", "levels", "reason", "relevance"], properties: { parentId: { type: ["string", "null"] }, levels: { type: "array", maxItems: CAPTURE_PATH_MAX_LEVELS, items: { type: "string" } }, reason: { type: "string" }, relevance: CLASSIFICATION_RELEVANCE_SCHEMA } } },
    contradiction: { type: ["string", "null"], description: "Après les alternatives, explique la divergence entre faits du document, affirmations du contexte ou usage demandé, sans convertir une consigne en nature du document ni arbitrer les sources ou leur lien. Une intention peut étayer un usage sans prouver ce lien ; null en l’absence de divergence." },
  },
};
const instructions = classificationInstructions("existing", "created");
export const OPENAI_CLASSIFICATION_CONTRACT_SHA256 = createHash("sha256")
  .update(JSON.stringify({ reference: CLASSIFICATION_REFERENCE, instructions, schema })).digest("hex");
function contextBytes(payload: Pick<ProviderPayload, "folders" | "canCreateRoot" | "comment">) {
  return Buffer.byteLength(classificationContext(payload)) + Buffer.byteLength(instructions) + Buffer.byteLength(JSON.stringify(schema));
}
async function boundedResponse(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw new Error("Provider unavailable");
  const buffers: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 65_536) { await reader.cancel(); throw new Error("Provider response too large"); }
      buffers.push(next.value);
    }
    return JSON.parse(Buffer.concat(buffers).toString("utf8")) as Record<string, unknown>;
  } finally { reader.releaseLock(); }
}
/** Dormant until profiles AND the service's allowRemote gate are configured.
 * Sources: https://developers.openai.com/api/docs/guides/file-inputs
 * https://developers.openai.com/api/docs/guides/structured-outputs */
export function createOpenAIClassificationProvider(profiles: readonly QualifiedOpenAIProfile[] = [], transport: typeof fetch = fetch): ClassificationProvider {
  function profile(config: ClassificationConfiguration, payload?: ProviderPayload) {
    const found = profiles.find(item => item.model === config.model);
    if (found?.classificationContractSha256 !== OPENAI_CLASSIFICATION_CONTRACT_SHA256 || config.provider !== "openai" || config.currency !== "EUR" || !found || found.currency !== "EUR" || !found.qualificationRef.trim()) return null;
    try { micros(found.maximumMicros, true); } catch { return null; }
    if (![found.maxInputBytes, found.maxFolderBytes, found.maxOutputTokens].every(n => Number.isSafeInteger(n) && n > 0)) return null;
    if (found.maxFolderBytes < contextBytes({ folders: [] }) || found.maxInputBytes > 20 * 1024 * 1024 || found.maxFolderBytes > 1_048_576 || found.maxOutputTokens > 32_768) return null;
    if (payload && (payload.bytes.byteLength > found.maxInputBytes || !found.mediaTypes.includes(payload.mediaType)
      || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(payload.mediaType)
      || contextBytes(payload) > found.maxFolderBytes)) return null;
    return found;
  }
  return {
    id: "openai", label: "OpenAI", mode: "remote",
    models: profiles.filter(item => profile({ provider: "openai", model: item.model, currency: "EUR", enabled: false, monthlyLimitMicros: 0, version: 1 })).map(item => ({ id: item.model, label: item.model })),
    quote(config, payload) { const found = profile(config, payload); return found ? { maximumMicros: found.maximumMicros, currency: "EUR" } : null; },
    // Configuration checking performs a small bounded Responses call, charged
    // conservatively by the same maximum. It is never performed during save.
    quoteCheck(config) { const found = profile(config); return found ? { maximumMicros: found.maximumMicros, currency: "EUR" } : null; },
    async analyze(config, payload, credential, signal) {
      const found = profile(config, payload); if (!found) throw new Error("Unqualified classification profile");
      const encoded = Buffer.from(payload.bytes).toString("base64");
      const content = payload.mediaType === "application/pdf"
        ? { type: "input_file", filename: "selected-document.pdf", file_data: `data:application/pdf;base64,${encoded}` }
        : { type: "input_image", image_url: `data:${payload.mediaType};base64,${encoded}` };
      const result = await transport("https://api.openai.com/v1/responses", {
        method: "POST", signal, redirect: "error", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: found.model, store: false, max_output_tokens: found.maxOutputTokens, tools: [],
          instructions,
          input: [{ role: "user", content: [{ type: "input_text", text: classificationContext(payload) }, content] }],
          text: { format: { type: "json_schema", name: "classification", strict: true, schema } } }),
      });
      if (!result.ok) { await result.body?.cancel(); throw new Error("Provider unavailable"); }
      const body = await boundedResponse(result);
      let actual: number | null = null;
      try { const cost = found.actualCost(body.usage); actual = cost === null ? null : micros(cost); } catch { /* Unknown pricing retains debt. */ }
      if (body.status !== "completed" || !Array.isArray(body.output)) return { value: null, actualMicros: actual };
      const texts: string[] = [];
      for (const item of body.output) {
        if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
        for (const part of item.content) if (part?.type === "output_text" && typeof part.text === "string") texts.push(part.text);
      }
      return { value: normalizeClassificationSuggestions(texts.length === 1 ? texts[0] : null, "existing", "created"), actualMicros: actual };
    },
    async check(config, credential, signal) {
      const found = profile(config); if (!found) throw new Error("Unqualified classification profile");
      const result = await transport("https://api.openai.com/v1/responses", { method: "POST", signal, redirect: "error",
        headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: found.model, store: false, max_output_tokens: found.maxOutputTokens, tools: [], input: "Réponds uniquement OK." }) });
      if (!result.ok) { await result.body?.cancel(); return { status: result.status === 401 || result.status === 403 ? "invalid" : "unreachable", actualMicros: null }; }
      const body = await boundedResponse(result); let actual: number | null = null;
      try { const cost = found.actualCost(body.usage); actual = cost === null ? null : micros(cost); } catch { /* Keep debt. */ }
      return { status: body.status === "completed" ? "accepted" : "unreachable", actualMicros: actual };
    },
  };
}
