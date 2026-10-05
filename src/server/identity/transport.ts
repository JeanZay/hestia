import type { ServerConfig } from "../config";
import type { MailTransport } from "./outbox";
import { MailDeliveryError } from "./mail-error";

const address = (value: unknown): value is string => typeof value === "string" && value.length <= 254
  && /^[^@\s<>,;:"\\\x00-\x1f\x7f]+@[^@\s<>,;:"\\\x00-\x1f\x7f]+\.[^@\s<>,;:"\\\x00-\x1f\x7f]+$/.test(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function boundedBody(result: Response): Promise<unknown> {
  const reader = result.body?.getReader();
  if (!reader) throw new MailDeliveryError(true);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length;
      if (length > 2048) { await reader.cancel(); throw new MailDeliveryError(true); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** No external transport in local mode, even with inherited provider credentials. */
export function createResendTransport(config: ServerConfig, env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch): MailTransport | undefined {
  if (config.environment === "local" || !env.HESTIA_MAIL_PROVIDER) return undefined;
  if (env.HESTIA_MAIL_PROVIDER !== "resend" || !address(env.HESTIA_MAIL_FROM)
    || !env.RESEND_API_KEY || /\s/.test(env.RESEND_API_KEY)) throw new Error("MAIL_CONFIGURATION_INVALID");
  const from = env.HESTIA_MAIL_FROM, key = env.RESEND_API_KEY;
  const origin = new URL(config.origin);
  if (origin.protocol !== "https:" || origin.origin !== config.origin) throw new Error("MAIL_CONFIGURATION_INVALID");
  return async message => {
    const { id, template, parameters: p } = message;
    if (!uuid.test(id) || !p || !address(p.email)) throw new MailDeliveryError(false);
    let subject: string, text: string;
    if (template === "invitation") {
      if (Object.keys(p).sort().join(",") !== "email,url" || typeof p.url !== "string" || p.url.length > 2048)
        throw new MailDeliveryError(false);
      let link: URL;
      try { link = new URL(p.url); } catch { throw new MailDeliveryError(false); }
      if (link.origin !== config.origin || link.username || link.password || link.pathname !== "/"
        || [...link.searchParams.keys()].sort().join(",") !== "flowId,kind"
        || !uuid.test(link.searchParams.get("flowId") ?? "")
        || !["bootstrap", "invite", "readmit", "exceptional"].includes(link.searchParams.get("kind") ?? "")
        || !/^#capability=[A-Za-z0-9_-]{43}$/.test(link.hash)) throw new MailDeliveryError(false);
      subject = "Votre accès à Hestia";
      text = `Pour poursuivre votre accès à Hestia, ouvrez ce lien personnel :\n\n${p.url}\n\nNe partagez pas ce lien. Si vous n’attendiez pas ce message, ignorez-le.`;
    } else if (template === "otp") {
      if (Object.keys(p).sort().join(",") !== "email,otp" || !/^\d{6}$/.test(p.otp ?? "")) throw new MailDeliveryError(false);
      subject = "Votre code Hestia";
      text = `Votre code de vérification Hestia : ${p.otp}\n\nIl expire dix minutes après sa demande. Ne le partagez pas. Si vous n’avez pas demandé ce code, ignorez ce message.`;
    } else if (template === "email-changed") {
      if (Object.keys(p).join(",") !== "email") throw new MailDeliveryError(false);
      subject = "Votre adresse Hestia a changé";
      text = "L’adresse de votre compte Hestia a été modifiée après récupération de votre accès. Si vous n’êtes pas à l’origine de cette action, contactez votre exploitant de confiance par votre canal habituel.";
    } else throw new MailDeliveryError(false);
    // The endpoint, payload and key remain stable across ambiguous retries.
    // Never log a provider body: it may echo recipients or private links.
    try {
      const payload = JSON.stringify({ from, to: [p.email], subject, text });
      if (typeof message.bindPayload !== "function" || !await message.bindPayload(payload)) throw new MailDeliveryError(false);
      const result = await request("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": "hestia/0.1", "Idempotency-Key": `hestia/${id}` },
        body: payload,
      });
      if (!result.ok) {
        let permanentConflict = false;
        if (result.status === 409) {
          try {
            const errorBody = await boundedBody(result) as { name?: unknown } | null;
            permanentConflict = errorBody?.name === "invalid_idempotent_request";
          } catch { /* Unknown conflict remains bounded by the outbox retry policy. */ }
        } else await result.body?.cancel();
        const delay = Number(result.headers.get("retry-after"));
        throw new MailDeliveryError(!permanentConflict && (result.status === 408 || result.status === 409 || result.status === 429 || result.status >= 500),
          Number.isFinite(delay) && delay > 0 ? Math.min(delay, 3600) : undefined);
      }
      const body = await boundedBody(result) as { id?: unknown } | null;
      if (!body || typeof body.id !== "string" || !uuid.test(body.id)) throw new MailDeliveryError(true);
    } catch (error) {
      if (error instanceof MailDeliveryError) throw error;
      throw new MailDeliveryError(true);
    }
  };
}
