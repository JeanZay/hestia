import type { ServerConfig } from "../config";
import type { ClassificationDependencies } from "./types";
import { createOpenRouterClassificationProvider, parseQualifiedOpenRouterProfile } from "./openrouter";

export const DEV_CLASSIFICATION_CEILING_MICROS = 50_000_000;
export const PRODUCTION_CLASSIFICATION_CEILING_MICROS = 50_000_000;

/** A deployment profile contains no credential. Credentials remain encrypted in
 * the existing settings store; reading configuration never contacts a provider. */
export function readClassificationDeployment(
  environment: ServerConfig["environment"],
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: () => Date = () => new Date(),
): Partial<Omit<ClassificationDependencies, "capture">> {
  const deploymentLimitMicros = environment === "production" ? PRODUCTION_CLASSIFICATION_CEILING_MICROS
    : environment === "dev" ? DEV_CLASSIFICATION_CEILING_MICROS : undefined;
  const disabled = { providers: [], allowRemote: false,
    ...(deploymentLimitMicros === undefined ? {} : { deploymentLimitMicros }) };
  const activation = environment === "production" ? "openrouter-haiku-production" : "openrouter-haiku-dev";
  if ((environment !== "dev" && environment !== "production") || env.HESTIA_CLASSIFICATION_REMOTE !== activation) return disabled;
  const source = env.HESTIA_OPENROUTER_PROFILE;
  if (!source || Buffer.byteLength(source) > 16_384) return disabled;
  try {
    const profile = parseQualifiedOpenRouterProfile(JSON.parse(source), now());
    if (!profile) return disabled;
    return { providers: [createOpenRouterClassificationProvider([profile], fetch, now)], allowRemote: true,
      deploymentLimitMicros };
  } catch { return disabled; }
}
